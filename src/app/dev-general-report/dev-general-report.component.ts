import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import {
  collection,
  getDocs,
  getFirestore,
  orderBy,
  query,
} from "firebase/firestore";
import { firebaseApp } from "../firebase.config";

interface PerformanceRecord {
  timestamp: string;
  student: string;
  level: string;
  phase: number;
  score: number;
  totalQuestions: number;
  percent: number;
  createdAt?: number;
}

interface StudentSummary {
  student: string;
  attempts: number;
  avgPercent: number;
  bestPercent: number;
  totalCorrect: number;
  totalQuestions: number;
  lastRecordAt: number;
}

interface LessonAccessRecord {
  timestamp: string;
  student: string;
  lessonNumber: number;
  lessonTitle: string;
  sourceType: "local" | "youtube";
  createdAt?: number;
}

interface LessonAccessSummary {
  lessonNumber: number;
  lessonTitle: string;
  totalAccesses: number;
  uniqueStudents: number;
  lastAccessAt: number;
}

interface AppAccessRecord {
  student: string;
  timestamp: string;
  createdAt?: number;
}

@Component({
  selector: "app-dev-general-report",
  standalone: true,
  imports: [CommonModule],
  templateUrl: "./dev-general-report.component.html",
  styleUrl: "./dev-general-report.component.css",
})
export class DevGeneralReportComponent implements OnInit {
  records: PerformanceRecord[] = [];
  lessonAccessRecords: LessonAccessRecord[] = [];
  appAccessRecords: AppAccessRecord[] = [];
  isLoading = false;
  errorMessage = "";
  lessonAccessError = "";
  appAccessError = "";
  expandedStudent = "";

  private readonly firestoreDb = getFirestore(firebaseApp);

  ngOnInit(): void {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = "";
    this.lessonAccessError = "";
    this.appAccessError = "";

    try {
      const recordsQuery = query(
        collection(this.firestoreDb, "results"),
        orderBy("createdAt", "desc"),
      );
      const snapshot = await getDocs(recordsQuery);

      this.records = snapshot.docs.map((item) => {
        const data = item.data() as PerformanceRecord;
        return {
          timestamp: data.timestamp ?? "",
          student: data.student ?? "",
          level: data.level ?? "",
          phase: data.phase ?? 0,
          score: data.score ?? 0,
          totalQuestions: data.totalQuestions ?? 0,
          percent: data.percent ?? 0,
          createdAt: data.createdAt,
        };
      });

      try {
        // Evita falhas por indice/ordenacao na colecao nova de acessos.
        const lessonSnapshot = await getDocs(
          collection(this.firestoreDb, "lesson-accesses"),
        );

        this.lessonAccessRecords = lessonSnapshot.docs
          .map((item) => {
            const data = item.data() as LessonAccessRecord;
            return {
              timestamp: data.timestamp ?? "",
              student: data.student ?? "",
              lessonNumber: data.lessonNumber ?? 0,
              lessonTitle: data.lessonTitle ?? "",
              sourceType: data.sourceType ?? "youtube",
              createdAt: data.createdAt,
            };
          })
          .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      } catch {
        this.lessonAccessRecords = [];
        this.lessonAccessError =
          "Nao foi possivel carregar os acessos das aulas de flauta.";
      }

      try {
        const appAccessSnapshot = await getDocs(
          collection(this.firestoreDb, "app-accesses"),
        );
        this.appAccessRecords = appAccessSnapshot.docs
          .map((item) => {
            const data = item.data() as AppAccessRecord;
            return {
              student: data.student ?? "",
              timestamp: data.timestamp ?? "",
              createdAt: data.createdAt,
            };
          })
          .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      } catch {
        this.appAccessRecords = [];
        this.appAccessError = "Nao foi possivel carregar os acessos ao app.";
      }
    } catch {
      this.records = [];
      this.lessonAccessRecords = [];
      this.appAccessRecords = [];
      this.errorMessage =
        "Nao foi possivel carregar o relatorio geral do Firestore.";
    } finally {
      this.isLoading = false;
    }
  }

  get totalStudents(): number {
    return new Set(
      this.records.map((item) => item.student.trim()).filter(Boolean),
    ).size;
  }

  get totalAttempts(): number {
    return this.records.length;
  }

  get totalLessonAccesses(): number {
    return this.lessonAccessRecords.length;
  }

  get totalAppAccesses(): number {
    return this.appAccessRecords.length;
  }

  get lessonAccessSummaries(): LessonAccessSummary[] {
    const grouped = new Map<
      number,
      LessonAccessSummary & { students: Set<string> }
    >();

    for (const access of this.lessonAccessRecords) {
      if (!access.lessonNumber) {
        continue;
      }

      const current = grouped.get(access.lessonNumber);
      const lastAccessAt = access.createdAt ?? 0;
      const student = access.student.trim() || "Sem nome";

      if (!current) {
        grouped.set(access.lessonNumber, {
          lessonNumber: access.lessonNumber,
          lessonTitle: access.lessonTitle || `Aula ${access.lessonNumber}`,
          totalAccesses: 1,
          uniqueStudents: 0,
          lastAccessAt,
          students: new Set([student]),
        });
        continue;
      }

      current.totalAccesses += 1;
      current.lastAccessAt = Math.max(current.lastAccessAt, lastAccessAt);
      current.students.add(student);
    }

    return Array.from(grouped.values())
      .map(({ students, ...summary }) => ({
        ...summary,
        uniqueStudents: students.size,
      }))
      .sort((a, b) => a.lessonNumber - b.lessonNumber);
  }

  accessesByLesson(lessonNumber: number): LessonAccessRecord[] {
    return this.lessonAccessRecords
      .filter((item) => item.lessonNumber === lessonNumber)
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }

  get studentSummaries(): StudentSummary[] {
    const grouped = new Map<string, StudentSummary>();

    for (const record of this.records) {
      const student = record.student.trim() || "Sem nome";
      const current = grouped.get(student);
      const createdAt = record.createdAt ?? 0;

      if (!current) {
        grouped.set(student, {
          student,
          attempts: 1,
          avgPercent: record.percent,
          bestPercent: record.percent,
          totalCorrect: record.score,
          totalQuestions: record.totalQuestions,
          lastRecordAt: createdAt,
        });
        continue;
      }

      current.attempts += 1;
      current.totalCorrect += record.score;
      current.totalQuestions += record.totalQuestions;
      current.bestPercent = Math.max(current.bestPercent, record.percent);
      current.lastRecordAt = Math.max(current.lastRecordAt, createdAt);
      current.avgPercent =
        (current.avgPercent * (current.attempts - 1) + record.percent) /
        current.attempts;
    }

    return Array.from(grouped.values()).sort(
      (a, b) => b.lastRecordAt - a.lastRecordAt,
    );
  }

  toggleStudentDetails(student: string): void {
    this.expandedStudent = this.expandedStudent === student ? "" : student;
  }

  isStudentExpanded(student: string): boolean {
    return this.expandedStudent === student;
  }

  attemptsByStudent(student: string): PerformanceRecord[] {
    return this.records
      .filter((item) => (item.student.trim() || "Sem nome") === student)
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }
}

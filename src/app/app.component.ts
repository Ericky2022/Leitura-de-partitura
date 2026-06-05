import { CommonModule } from "@angular/common";
import { Component, ElementRef, ViewChild, isDevMode } from "@angular/core";
import { FormsModule } from "@angular/forms";
import {
  addDoc,
  collection,
  deleteDoc,
  getDocs,
  getFirestore,
  query,
  where,
} from "firebase/firestore";
import { DevGeneralReportComponent } from "./dev-general-report/dev-general-report.component";
import { FluteLessonsComponent } from "./flute-lessons/flute-lessons.component";
import { RhythmExercisesComponent } from "./rhythm-exercises/rhythm-exercises.component";
import { firebaseApp } from "./firebase.config";

type Screen =
  | "home"
  | "phases"
  | "exercise"
  | "report"
  | "ear-menu"
  | "pentagrama"
  | "learning-menu"
  | "flute-lessons"
  | "rhythm-exercises"
  | "dev-report";

interface MusicNote {
  displayName: string;
  answerLabel: string;
  audioKey: string;
  duration: number;
  staffStep: number;
  rhythmLabel: string;
}

interface EarRangeConfig {
  label: string;
  notes: MusicNote[];
}

interface StageConfig {
  level: "easy" | "medium" | "hard";
  duration: number;
  phase: number;
}

interface LevelConfig {
  title: string;
  durationLabel: string;
  accentColor: string;
  stageStart: number;
  phases: string[];
}

interface ResultState {
  title: string;
  content: string;
  isBad: boolean;
  isGood: boolean;
  isLast: boolean;
}

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

interface FluteLessonAccessRecord {
  timestamp: string;
  student: string;
  lessonNumber: number;
  lessonTitle: string;
  sourceType: "local" | "youtube";
  createdAt?: number;
}

const firestoreDb = getFirestore(firebaseApp);

@Component({
  selector: "app-root",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DevGeneralReportComponent,
    FluteLessonsComponent,
    RhythmExercisesComponent,
  ],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
})
export class AppComponent {
  @ViewChild("staffCanvas") staffCanvas?: ElementRef<HTMLCanvasElement>;

  private readonly localResultsStorageKey = "tm-local-results";

  readonly options = ["Dó", "Ré", "Mi", "Fá", "Sol", "Lá", "Si"];
  readonly isDevelopment = isDevMode();
  readonly totalQuestions = 20;
  readonly goodPercent = 75;
  readonly excellentPercent = 85;

  readonly stages: StageConfig[] = [
    { level: "easy", duration: 4, phase: 1 },
    { level: "easy", duration: 4, phase: 2 },
    { level: "easy", duration: 4, phase: 3 },
    { level: "easy", duration: 4, phase: 4 },
    { level: "medium", duration: 2, phase: 1 },
    { level: "medium", duration: 2, phase: 2 },
    { level: "medium", duration: 2, phase: 3 },
    { level: "medium", duration: 2, phase: 4 },
    { level: "hard", duration: 1, phase: 1 },
    { level: "hard", duration: 1, phase: 2 },
    { level: "hard", duration: 1, phase: 3 },
    { level: "hard", duration: 1, phase: 4 },
  ];

  readonly levels: LevelConfig[] = [
    {
      title: "Inicial",
      durationLabel: "4 tempos",
      accentColor: "#005f73",
      stageStart: 0,
      phases: [
        "Notas de Dó a Sol (4 tempos)",
        "Notas de Dó a Dó (4 tempos)",
        "Dó a Sol da segunda oitava (4 tempos)",
        "Dó da 1ª oitava até Sol da 2ª oitava (4 tempos)",
      ],
    },
    {
      title: "Intermediário",
      durationLabel: "2 tempos",
      accentColor: "#0a9396",
      stageStart: 4,
      phases: [
        "Notas de Dó a Sol (2 tempos)",
        "Notas de Dó a Dó (2 tempos)",
        "Dó a Sol da segunda oitava (2 tempos)",
        "Dó da 1ª oitava até Sol da 2ª oitava (2 tempos)",
      ],
    },
    {
      title: "Avançado",
      durationLabel: "1 tempo",
      accentColor: "#9b2226",
      stageStart: 8,
      phases: [
        "Notas de Dó a Sol (1 tempo)",
        "Notas de Dó a Dó (1 tempo)",
        "Dó a Sol da segunda oitava (1 tempo)",
        "Dó da 1ª oitava até Sol da 2ª oitava (1 tempo)",
      ],
    },
  ];

  screen: Screen = "home";
  private previousScreen: Screen = "home";
  playerNameInput = "";
  playerName = "";
  showOptions = false;

  selectedLevelIndex = 0;
  earRangeIndex = 0;
  isEarMode = false;
  isLearningMode = false;
  learningPhase = 1;

  readonly earRanges: EarRangeConfig[] = this.buildEarRanges();

  stageIndex = 0;
  notes: MusicNote[] = [];
  learningNotesSequence: MusicNote[] = [];
  learningNoteIndex = 0;
  currentNote?: MusicNote;
  currentQuestion = 1;
  score = 0;
  counter = 0;
  isAnswered = false;

  feedback = "";
  feedbackCorrect = false;

  modalVisible = false;
  resultState?: ResultState;
  performanceRecordsData: PerformanceRecord[] = [];
  localPerformanceRecordsData: PerformanceRecord[] = [];
  isReportLoading = false;
  reportError = "";

  private readonly noteAudioPaths: Record<string, string> = {
    C1: "assets/audio/C1.MP3",
    D1: "assets/audio/D1.MP3",
    E1: "assets/audio/E1.MP3",
    F1: "assets/audio/F1.MP3",
    G1: "assets/audio/G1.MP3",
    A1: "assets/audio/A1.MP3",
    B1: "assets/audio/B1.MP3",
    C2: "assets/audio/C2.MP3",
    D2: "assets/audio/D2.MP3",
    E2: "assets/audio/E2.MP3",
    F2: "assets/audio/F2.MP3",
    G2: "assets/audio/G2.MP3",
  };

  private readonly errorAudioPath = "assets/audio/error.mp3";
  private readonly countdownAudioPath = "assets/audio/contagem.wav";

  private readonly audioCache = new Map<string, HTMLAudioElement>();

  private timerId?: ReturnType<typeof setTimeout>;

  constructor() {
    this.loadLocalPerformanceRecords();
  }

  get stage(): StageConfig {
    return this.stages[this.stageIndex];
  }

  get levelPhaseLabel(): string {
    if (this.isLearningMode) {
      return `Conhecendo as notas - Fase ${this.learningPhase}`;
    }

    if (this.isEarMode) {
      return `Teste de ouvido - ${this.earRanges[this.earRangeIndex].label}`;
    }

    return `${this.levelLabel(this.stage.level)} - Fase ${this.stage.phase}`;
  }

  get counterPercent(): number {
    if (this.isEarMode) {
      return 0;
    }

    return Math.max(
      0,
      Math.min(100, (this.counter / this.stage.duration) * 100),
    );
  }

  get currentOptions(): string[] {
    if (this.isEarMode) {
      return this.notes.map((item) => item.answerLabel);
    }

    return this.options;
  }

  get learningNoteDisplayName(): string {
    if (!this.currentNote) {
      return "";
    }

    return this.currentNote.displayName.replaceAll(/\d+$/g, "");
  }

  get isLearningPhaseOne(): boolean {
    return this.isLearningMode && this.learningPhase === 1;
  }

  get isLearningPhaseTwo(): boolean {
    return this.isLearningMode && this.learningPhase === 2;
  }

  get performanceCount(): number {
    return this.performanceRecordsData.length;
  }

  get localPerformanceCount(): number {
    const normalizedPlayerName = this.normalizeStudentName(this.playerName);
    if (!normalizedPlayerName) {
      return 0;
    }

    return this.localPerformanceRecordsData.filter(
      (record) =>
        this.normalizeStudentName(record.student) === normalizedPlayerName,
    ).length;
  }

  get performanceRecords(): PerformanceRecord[] {
    return [...this.performanceRecordsData].reverse();
  }

  get averagePercent(): number {
    const records = this.performanceRecordsData;
    if (records.length === 0) {
      return 0;
    }

    const total = records.reduce((sum, record) => sum + record.percent, 0);
    return total / records.length;
  }

  startTraining(): void {
    const name = this.playerNameInput.trim();
    if (!name) {
      alert("Digite seu nome para começar.");
      return;
    }
    this.playerName = name;
    this.loadLocalPerformanceRecords();
    this.showOptions = true;
    void this.refreshPerformanceRecords();
    void this.saveAppAccess(name);
  }

  openPhases(levelIdx: number): void {
    this.selectedLevelIndex = levelIdx;
    this.screen = "phases";
  }

  openEarMenu(): void {
    this.clearTimer();
    this.modalVisible = false;
    this.isLearningMode = false;
    this.screen = "ear-menu";
  }

  openPentagramaMenu(): void {
    this.clearTimer();
    this.modalVisible = false;
    this.isEarMode = false;
    this.isLearningMode = false;
    this.screen = "pentagrama";
  }

  openLearningMenu(): void {
    this.clearTimer();
    this.modalVisible = false;
    this.isEarMode = false;
    this.isLearningMode = false;
    this.previousScreen = this.screen;
    this.screen = "learning-menu";
  }

  openFluteLesson(): void {
    this.clearTimer();
    this.modalVisible = false;
    this.isEarMode = false;
    this.isLearningMode = false;
    this.previousScreen = this.screen;
    this.screen = "flute-lessons";
    this.scrollToTop();
  }

  openRhythmExercises(): void {
    this.clearTimer();
    this.modalVisible = false;
    this.isEarMode = false;
    this.isLearningMode = false;
    this.previousScreen = this.screen;
    this.screen = "rhythm-exercises";
    this.scrollToTop();
  }

  returnToPreviousScreen(): void {
    this.clearTimer();
    this.modalVisible = false;
    this.isEarMode = false;
    this.isLearningMode = false;
    this.screen = this.previousScreen;
  }

  registerFluteLessonAccess(event: {
    lessonNumber: number;
    lessonTitle: string;
    sourceType: "local" | "youtube";
  }): void {
    const normalizedStudent = this.playerName.trim() || "Sem nome";

    const record: FluteLessonAccessRecord = {
      timestamp: new Date().toLocaleString("pt-BR"),
      student: normalizedStudent,
      lessonNumber: event.lessonNumber,
      lessonTitle: event.lessonTitle,
      sourceType: event.sourceType,
    };

    void this.saveFluteLessonAccess(record);
  }

  startLearningPhase(phase: 1 | 2): void {
    this.clearTimer();
    this.modalVisible = false;
    this.isEarMode = false;
    this.isLearningMode = true;
    this.learningPhase = phase;
    this.learningNotesSequence = this.buildLearningNotesSequence();
    this.learningNoteIndex = 0;
    this.currentQuestion = 1;
    this.score = 0;
    this.isAnswered = false;
    this.feedback = "";
    this.counter = 0;
    this.screen = "exercise";
    this.setLearningNoteByIndex(this.learningNoteIndex);
  }

  openReport(): void {
    this.clearTimer();
    this.modalVisible = false;
    this.screen = "report";
    void this.refreshPerformanceRecords();
  }

  openDevGeneralReport(): void {
    if (!this.isDevelopment) {
      return;
    }

    this.clearTimer();
    this.modalVisible = false;
    this.screen = "dev-report";
  }

  goHome(): void {
    this.clearTimer();
    this.modalVisible = false;
    this.isLearningMode = false;
    this.previousScreen = "home";
    this.screen = "home";
  }

  startExercise(stageIndex: number): void {
    this.clearTimer();
    this.modalVisible = false;
    this.isEarMode = false;
    this.isLearningMode = false;
    this.stageIndex = stageIndex;
    this.notes = this.getNotesByPhase(this.stage.phase, this.stage.duration);
    this.currentQuestion = 1;
    this.score = 0;
    this.isAnswered = false;
    this.feedback = "";
    this.counter = 0;
    this.screen = "exercise";
    this.generateQuestion();
  }

  startEarExercise(rangeIndex: number): void {
    this.clearTimer();
    this.modalVisible = false;
    this.isEarMode = true;
    this.isLearningMode = false;
    this.earRangeIndex = rangeIndex;
    this.notes = this.earRanges[rangeIndex].notes;
    this.currentQuestion = 1;
    this.score = 0;
    this.isAnswered = false;
    this.feedback = "";
    this.counter = 0;
    this.screen = "exercise";
    this.generateQuestion();
  }

  checkAnswer(selected: string): void {
    if (this.isLearningPhaseTwo) {
      this.checkLearningPhaseTwoAnswer(selected);
      return;
    }

    if (this.isAnswered || !this.currentNote) {
      return;
    }

    this.clearTimer();
    this.isAnswered = true;

    const correct = selected === this.currentNote.answerLabel;
    let feedbackAudio: Promise<void>;

    if (correct) {
      this.score++;
      feedbackAudio = this.playNoteAudio(
        this.currentNote.audioKey,
        this.isEarMode,
      );
    } else {
      feedbackAudio = this.playAudio(this.errorAudioPath, 1, this.isEarMode);
    }

    this.feedbackCorrect = correct;
    this.feedback = correct
      ? "Acertou!"
      : `Errou! Resposta correta: ${this.currentNote.answerLabel}`;

    if (this.isEarMode) {
      setTimeout(() => this.drawStaff(), 0);
    }

    if (this.isEarMode) {
      void feedbackAudio.finally(() => this.moveToNext());
      return;
    }

    setTimeout(() => this.moveToNext(), 1000);
  }

  closeModalToPhases(): void {
    this.modalVisible = false;
    if (this.isLearningMode) {
      this.openLearningMenu();
      return;
    }

    this.screen = this.isEarMode ? "ear-menu" : "phases";
  }

  retryCurrent(): void {
    this.modalVisible = false;
    if (this.isEarMode) {
      this.startEarExercise(this.earRangeIndex);
      return;
    }

    this.startExercise(this.stageIndex);
  }

  replayCurrentNote(): void {
    if (!this.currentNote || this.isAnswered) {
      return;
    }

    void this.playNoteAudio(this.currentNote.audioKey);
  }

  nextLearningNote(): void {
    if (!this.isLearningPhaseOne || this.learningNotesSequence.length === 0) {
      return;
    }

    const isLastNote =
      this.learningNoteIndex >= this.learningNotesSequence.length - 1;
    if (isLastNote) {
      this.finishLearningMode();
      return;
    }

    const nextIndex = this.learningNoteIndex + 1;
    this.setLearningNoteByIndex(nextIndex);
  }

  previousLearningNote(): void {
    if (!this.isLearningPhaseOne || this.learningNotesSequence.length === 0) {
      return;
    }

    const previousIndex =
      (this.learningNoteIndex - 1 + this.learningNotesSequence.length) %
      this.learningNotesSequence.length;
    this.setLearningNoteByIndex(previousIndex);
  }

  clearPerformanceData(): void {
    if (!confirm("Deseja apagar apenas o seu histórico salvo?")) {
      return;
    }

    void this.clearFirestoreRecords();
  }

  private async clearFirestoreRecords(): Promise<void> {
    const studentName = this.playerName.trim();
    if (!studentName) {
      return;
    }

    try {
      const recordsQuery = query(
        collection(firestoreDb, "results"),
        where("student", "==", studentName),
      );
      const snapshot = await getDocs(recordsQuery);
      await Promise.all(snapshot.docs.map((item) => deleteDoc(item.ref)));

      this.performanceRecordsData = [];
      this.localPerformanceRecordsData =
        this.localPerformanceRecordsData.filter(
          (record) =>
            this.normalizeStudentName(record.student) !==
            this.normalizeStudentName(studentName),
        );
      this.persistLocalPerformanceRecords();
      this.reportError = "";
    } catch {
      this.reportError = "Nao foi possivel limpar o historico no Firestore.";
    }
  }

  mainModalAction(): void {
    if (!this.resultState) {
      return;
    }

    this.modalVisible = false;

    if (this.resultState.isBad) {
      if (this.isEarMode) {
        this.startEarExercise(this.earRangeIndex);
        return;
      }

      this.startExercise(this.stageIndex);
      return;
    }

    if (this.isEarMode) {
      this.openEarMenu();
      return;
    }

    if (this.resultState.isLast) {
      this.goHome();
      return;
    }

    this.startExercise(this.stageIndex + 1);
  }

  private generateQuestion(): void {
    if (this.isLearningMode) {
      return;
    }

    const previousAudioKey = this.currentNote?.audioKey;
    let next = this.notes[Math.floor(Math.random() * this.notes.length)];

    if (this.notes.length > 1 && previousAudioKey) {
      let guard = 0;
      while (next.audioKey === previousAudioKey && guard < 20) {
        next = this.notes[Math.floor(Math.random() * this.notes.length)];
        guard++;
      }
    }

    this.currentNote = next;
    this.isAnswered = false;
    this.feedback = "";
    this.counter = 0;

    setTimeout(() => this.drawStaff(), 0);

    if (this.isEarMode) {
      void this.playNoteAudio(next.audioKey);
      return;
    }

    this.startTimer();
  }

  private startTimer(): void {
    this.clearTimer();

    const tick = () => {
      if (this.isAnswered) {
        this.clearTimer();
        return;
      }

      if (this.counter >= this.stage.duration) {
        this.clearTimer();
        this.handleTimeout();
        return;
      }

      this.counter++;
      this.playAudio(
        this.countdownAudioPath,
        this.getCountdownVolume(this.counter, this.stage.duration),
      );
      this.timerId = setTimeout(tick, 1000);
    };

    this.timerId = setTimeout(tick, 1000);
  }

  private handleTimeout(): void {
    if (this.isAnswered || !this.currentNote) {
      return;
    }

    this.isAnswered = true;
    this.feedbackCorrect = false;
    this.feedback = `Tempo esgotado! Resposta correta: ${this.currentNote.answerLabel}`;
    this.playAudio(this.errorAudioPath);

    setTimeout(() => this.moveToNext(), 1000);
  }

  private moveToNext(): void {
    if (this.currentQuestion >= this.totalQuestions) {
      this.showResult();
      return;
    }

    this.currentQuestion++;
    this.generateQuestion();
  }

  private showResult(): void {
    this.clearTimer();

    const percent = (this.score / this.totalQuestions) * 100;
    const isBad = percent < this.goodPercent;
    const isGood =
      percent >= this.goodPercent && percent < this.excellentPercent;
    const isLast = this.isEarMode || this.stageIndex >= this.stages.length - 1;

    let statusText =
      "Parabéns! Você está indo muito bem, pode prosseguir para o próximo nível.";
    if (isBad) {
      statusText = "Recomendo você continuar estudando.";
    } else if (isGood) {
      statusText =
        "Muito bom! Você pode tentar novamente ou prosseguir para o próximo exercício.";
    }

    this.resultState = {
      title: isBad ? "Continue praticando" : "Resultado da fase",
      content:
        `Aluno: ${this.playerName}\n` +
        `${this.levelLabel(this.stage.level)} - Fase ${this.stage.phase}\n` +
        `Acertos: ${this.score} de ${this.totalQuestions}\n` +
        `Percentual de acerto: ${percent.toFixed(1)}%\n\n` +
        statusText,
      isBad,
      isGood,
      isLast,
    };

    void this.savePerformanceRecord({
      timestamp: new Date().toLocaleString("pt-BR"),
      student: this.playerName,
      level: this.isEarMode
        ? "Teste de ouvido"
        : this.levelLabel(this.stage.level),
      phase: this.isEarMode ? this.earRangeIndex + 1 : this.stage.phase,
      score: this.score,
      totalQuestions: this.totalQuestions,
      percent,
    });

    this.modalVisible = true;
  }

  private levelLabel(level: "easy" | "medium" | "hard"): string {
    if (level === "easy") {
      return "Inicial";
    }
    if (level === "medium") {
      return "Intermediário";
    }
    return "Avançado";
  }

  private getNotesByPhase(phase: number, duration: number): MusicNote[] {
    const note = (
      displayName: string,
      audioKey: string,
      staffStep: number,
    ): MusicNote => ({
      displayName,
      answerLabel: displayName,
      audioKey,
      duration,
      staffStep,
      rhythmLabel: this.rhythmLabel(duration),
    });

    switch (phase) {
      case 1:
        return [
          note("Dó", "C1", -2),
          note("Ré", "D1", -1),
          note("Mi", "E1", 0),
          note("Fá", "F1", 1),
          note("Sol", "G1", 2),
        ];
      case 2:
        return [
          note("Dó", "C1", -2),
          note("Ré", "D1", -1),
          note("Mi", "E1", 0),
          note("Fá", "F1", 1),
          note("Sol", "G1", 2),
          note("Lá", "A1", 3),
          note("Si", "B1", 4),
          note("Dó", "C2", 5),
        ];
      case 3:
        return [
          note("Dó", "C2", 5),
          note("Ré", "D2", 6),
          note("Mi", "E2", 7),
          note("Fá", "F2", 8),
          note("Sol", "G2", 9),
        ];
      case 4:
        return [
          note("Dó", "C1", -2),
          note("Ré", "D1", -1),
          note("Mi", "E1", 0),
          note("Fá", "F1", 1),
          note("Sol", "G1", 2),
          note("Lá", "A1", 3),
          note("Si", "B1", 4),
          note("Dó", "C2", 5),
          note("Ré", "D2", 6),
          note("Mi", "E2", 7),
          note("Fá", "F2", 8),
          note("Sol", "G2", 9),
        ];
      default:
        return [];
    }
  }

  private buildEarRanges(): EarRangeConfig[] {
    const duration = 1;
    const rhythmLabel = "Teste de ouvido";

    const allNotes: MusicNote[] = [
      {
        displayName: "Dó1",
        answerLabel: "Dó1",
        audioKey: "C1",
        duration,
        staffStep: -2,
        rhythmLabel,
      },
      {
        displayName: "Ré1",
        answerLabel: "Ré1",
        audioKey: "D1",
        duration,
        staffStep: -1,
        rhythmLabel,
      },
      {
        displayName: "Mi1",
        answerLabel: "Mi1",
        audioKey: "E1",
        duration,
        staffStep: 0,
        rhythmLabel,
      },
      {
        displayName: "Fá1",
        answerLabel: "Fá1",
        audioKey: "F1",
        duration,
        staffStep: 1,
        rhythmLabel,
      },
      {
        displayName: "Sol1",
        answerLabel: "Sol1",
        audioKey: "G1",
        duration,
        staffStep: 2,
        rhythmLabel,
      },
      {
        displayName: "Lá1",
        answerLabel: "Lá1",
        audioKey: "A1",
        duration,
        staffStep: 3,
        rhythmLabel,
      },
      {
        displayName: "Si1",
        answerLabel: "Si1",
        audioKey: "B1",
        duration,
        staffStep: 4,
        rhythmLabel,
      },
      {
        displayName: "Dó2",
        answerLabel: "Dó2",
        audioKey: "C2",
        duration,
        staffStep: 5,
        rhythmLabel,
      },
      {
        displayName: "Ré2",
        answerLabel: "Ré2",
        audioKey: "D2",
        duration,
        staffStep: 6,
        rhythmLabel,
      },
      {
        displayName: "Mi2",
        answerLabel: "Mi2",
        audioKey: "E2",
        duration,
        staffStep: 7,
        rhythmLabel,
      },
      {
        displayName: "Fá2",
        answerLabel: "Fá2",
        audioKey: "F2",
        duration,
        staffStep: 8,
        rhythmLabel,
      },
      {
        displayName: "Sol2",
        answerLabel: "Sol2",
        audioKey: "G2",
        duration,
        staffStep: 9,
        rhythmLabel,
      },
    ];

    return allNotes
      .map((_, idx) => ({ idx, notes: allNotes.slice(0, idx + 1) }))
      .filter((item) => item.idx >= 1)
      .map((item) => ({
        label: `Dó1 a ${allNotes[item.idx].displayName}`,
        notes: item.notes,
      }));
  }

  private buildLearningNotesSequence(): MusicNote[] {
    const highestRange = this.earRanges.at(-1);
    const ascending = (highestRange?.notes ?? []).map((note) => ({
      ...note,
      duration: 4,
      rhythmLabel: "Semibreve",
    }));

    if (ascending.length <= 1) {
      return ascending;
    }

    const descending = ascending.slice(0, -1).reverse();
    return [...ascending, ...descending];
  }

  private setLearningNoteByIndex(index: number): void {
    if (this.learningNotesSequence.length === 0) {
      return;
    }

    const safeIndex = Math.max(
      0,
      Math.min(index, this.learningNotesSequence.length - 1),
    );
    this.learningNoteIndex = safeIndex;
    this.currentQuestion = safeIndex + 1;
    this.currentNote = this.learningNotesSequence[safeIndex];
    this.isAnswered = false;
    this.feedback = "";
    this.feedbackCorrect = false;
    this.counter = 0;

    setTimeout(() => this.drawStaff(), 0);
    void this.playNoteAudio(this.currentNote.audioKey);
  }

  private checkLearningPhaseTwoAnswer(selected: string): void {
    if (!this.currentNote) {
      return;
    }

    const correct = selected === this.learningNoteDisplayName;
    this.feedbackCorrect = correct;

    if (!correct) {
      this.feedback = "Errou! Tente novamente.";
      void this.playAudio(this.errorAudioPath);
      return;
    }

    this.feedback = "Acertou!";
    this.score++;

    const isLastNote =
      this.learningNoteIndex >= this.learningNotesSequence.length - 1;
    if (isLastNote) {
      this.finishLearningMode();
      return;
    }

    setTimeout(() => {
      this.setLearningNoteByIndex(this.learningNoteIndex + 1);
    }, 350);
  }

  private finishLearningMode(): void {
    const totalLearningNotes = this.learningNotesSequence.length;
    if (totalLearningNotes === 0) {
      return;
    }

    this.clearTimer();

    this.resultState = {
      title: "Sequência concluída",
      content:
        `Aluno: ${this.playerName}\n` +
        `Conhecendo as notas - Fase ${this.learningPhase}\n` +
        `Notas concluídas: ${totalLearningNotes} de ${totalLearningNotes}\n` +
        "Parabéns! Você concluiu toda a sequência de notas.",
      isBad: false,
      isGood: false,
      isLast: true,
    };

    void this.savePerformanceRecord({
      timestamp: new Date().toLocaleString("pt-BR"),
      student: this.playerName,
      level: "Conhecendo as notas",
      phase: this.learningPhase,
      score: totalLearningNotes,
      totalQuestions: totalLearningNotes,
      percent: 100,
    });

    this.modalVisible = true;
  }

  private rhythmLabel(duration: number): string {
    if (duration === 4) {
      return "Semibreve (4 tempos)";
    }
    if (duration === 2) {
      return "Mínima (2 tempos)";
    }
    return "Semínima (1 tempo)";
  }

  private clearTimer(): void {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = undefined;
    }

    this.stopAudio(this.countdownAudioPath);
  }

  private playNoteAudio(audioKey: string, waitForEnd = false): Promise<void> {
    const audioPath = this.noteAudioPaths[audioKey];
    if (!audioPath) {
      return Promise.resolve();
    }

    return this.playAudio(audioPath, 1, waitForEnd);
  }

  private playAudio(
    audioPath: string,
    volume = 1,
    waitForEnd = false,
  ): Promise<void> {
    const resolvedAudioPath = this.resolveAssetUrl(audioPath);
    let audio = this.audioCache.get(resolvedAudioPath);

    if (!audio) {
      audio = new Audio(resolvedAudioPath);
      audio.preload = "auto";
      this.audioCache.set(resolvedAudioPath, audio);
    }

    audio.volume = Math.max(0, Math.min(1, volume));
    audio.currentTime = 0;

    if (!waitForEnd) {
      void audio.play().catch(() => {
        // Ignora falhas de autoplay para não quebrar o fluxo do exercício.
      });
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const onEnded = () => resolve();
      const onError = () => resolve();

      audio.addEventListener("ended", onEnded, { once: true });
      audio.addEventListener("error", onError, { once: true });

      void audio.play().catch(() => {
        audio.removeEventListener("ended", onEnded);
        audio.removeEventListener("error", onError);
        resolve();
      });
    });
  }

  private stopAudio(audioPath: string): void {
    const resolvedAudioPath = this.resolveAssetUrl(audioPath);
    const audio = this.audioCache.get(resolvedAudioPath);
    if (!audio) {
      return;
    }

    audio.pause();
    audio.currentTime = 0;
  }

  private resolveAssetUrl(relativePath: string): string {
    return new URL(relativePath, document.baseURI).toString();
  }

  private getCountdownVolume(currentTick: number, totalTicks: number): number {
    if (totalTicks <= 1) {
      return 1;
    }

    const minVolume = 0.25;
    const progress = (currentTick - 1) / (totalTicks - 1);
    return minVolume + (1 - minVolume) * progress;
  }

  private scrollToTop(): void {
    if (globalThis.window === undefined) {
      return;
    }

    globalThis.window.scrollTo({ top: 0, behavior: "auto" });
  }

  private async savePerformanceRecord(
    record: PerformanceRecord,
  ): Promise<void> {
    this.saveLocalPerformanceRecord(record);

    try {
      await addDoc(collection(firestoreDb, "results"), {
        ...record,
        createdAt: Date.now(),
      });
      await this.refreshPerformanceRecords();
    } catch {
      this.reportError = "Nao foi possivel salvar o resultado no Firestore.";
    }
  }

  private async saveAppAccess(student: string): Promise<void> {
    try {
      await addDoc(collection(firestoreDb, "app-accesses"), {
        student: student.trim(),
        timestamp: new Date().toLocaleString("pt-BR"),
        createdAt: Date.now(),
      });
    } catch {
      // Nao interrompe o fluxo caso o registro falhe.
    }
  }

  private async saveFluteLessonAccess(
    record: FluteLessonAccessRecord,
  ): Promise<void> {
    try {
      await addDoc(collection(firestoreDb, "lesson-accesses"), {
        ...record,
        createdAt: Date.now(),
      });
    } catch {
      // Nao interrompe o fluxo da aula caso o registro dev falhe.
    }
  }

  private saveLocalPerformanceRecord(record: PerformanceRecord): void {
    this.localPerformanceRecordsData = [
      ...this.localPerformanceRecordsData,
      { ...record, createdAt: Date.now() },
    ];
    this.persistLocalPerformanceRecords();
  }

  private loadLocalPerformanceRecords(): void {
    if (globalThis.window === undefined) {
      this.localPerformanceRecordsData = [];
      return;
    }

    try {
      const raw = globalThis.localStorage.getItem(this.localResultsStorageKey);
      if (!raw) {
        this.localPerformanceRecordsData = [];
        return;
      }

      const parsed = JSON.parse(raw) as PerformanceRecord[];
      this.localPerformanceRecordsData = Array.isArray(parsed)
        ? parsed.map((record) => ({
            timestamp: record.timestamp ?? "",
            student: record.student ?? "",
            level: record.level ?? "",
            phase: record.phase ?? 0,
            score: record.score ?? 0,
            totalQuestions: record.totalQuestions ?? this.totalQuestions,
            percent: record.percent ?? 0,
            createdAt: record.createdAt,
          }))
        : [];
    } catch {
      this.localPerformanceRecordsData = [];
    }
  }

  private persistLocalPerformanceRecords(): void {
    if (globalThis.window === undefined) {
      return;
    }

    try {
      globalThis.localStorage.setItem(
        this.localResultsStorageKey,
        JSON.stringify(this.localPerformanceRecordsData),
      );
    } catch {
      // Ignora falhas de escrita local para não interromper o fluxo do app.
    }
  }

  private normalizeStudentName(name: string): string {
    return name.trim().toLocaleLowerCase("pt-BR");
  }

  private async refreshPerformanceRecords(): Promise<void> {
    this.isReportLoading = true;
    this.reportError = "";

    const studentName = this.playerName.trim();
    if (!studentName) {
      this.performanceRecordsData = [];
      this.isReportLoading = false;
      return;
    }

    try {
      const recordsQuery = query(
        collection(firestoreDb, "results"),
        where("student", "==", studentName),
      );
      const snapshot = await getDocs(recordsQuery);

      this.performanceRecordsData = snapshot.docs
        .map((item) => {
          const data = item.data() as PerformanceRecord;
          return {
            timestamp: data.timestamp ?? "",
            student: data.student ?? "",
            level: data.level ?? "",
            phase: data.phase ?? 0,
            score: data.score ?? 0,
            totalQuestions: data.totalQuestions ?? this.totalQuestions,
            percent: data.percent ?? 0,
            createdAt: data.createdAt,
          };
        })
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    } catch {
      this.performanceRecordsData = [];
      this.reportError = "Nao foi possivel carregar o relatorio do Firestore.";
    } finally {
      this.isReportLoading = false;
    }
  }

  private drawStaff(): void {
    const canvas = this.staffCanvas?.nativeElement;
    const note = this.currentNote;
    if (!canvas || !note) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const width = canvas.width;
    const left = 24;
    const right = width - 24;
    const top = 55;
    const spacing = 22;
    const feedbackColor = this.getStaffFeedbackColor();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = feedbackColor;
    ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      const y = top + i * spacing;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }

    ctx.fillStyle = feedbackColor;
    ctx.font = "152px serif";
    const gLineY = top + 3 * spacing;
    ctx.fillText("𝄞", left - 8, gLineY + 30);

    const noteX = width * 0.56;
    const bottomLineY = top + 4 * spacing;
    const noteY = bottomLineY - note.staffStep * (spacing / 2);

    const topLineY = top;
    if (noteY < topLineY - 1) {
      let y = topLineY - spacing;
      while (y >= noteY - 1) {
        ctx.beginPath();
        ctx.moveTo(noteX - 22, y);
        ctx.lineTo(noteX + 22, y);
        ctx.stroke();
        y -= spacing;
      }
    }

    if (noteY > bottomLineY + 1) {
      let y = bottomLineY + spacing;
      while (y <= noteY + 1) {
        ctx.beginPath();
        ctx.moveTo(noteX - 22, y);
        ctx.lineTo(noteX + 22, y);
        ctx.stroke();
        y += spacing;
      }
    }

    ctx.save();
    ctx.translate(noteX, noteY);
    ctx.strokeStyle = feedbackColor;
    ctx.fillStyle = feedbackColor;
    ctx.lineWidth = 2;

    if (note.duration === 4) {
      ctx.beginPath();
      ctx.ellipse(0, 0, 17, 11, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.rotate(-0.22);
      ctx.beginPath();
      ctx.ellipse(0, 0, 15, 10, 0, 0, Math.PI * 2);
      if (note.duration === 2) {
        ctx.stroke();
      } else {
        ctx.fill();
      }
    }
    ctx.restore();

    if (note.duration === 2 || note.duration === 1) {
      ctx.beginPath();
      ctx.moveTo(noteX + 15, noteY - 1);
      ctx.lineTo(noteX + 15, noteY - 60);
      ctx.stroke();
    }
  }

  private getStaffFeedbackColor(): string {
    if (!this.isEarMode || !this.isAnswered) {
      return "#111";
    }

    return this.feedbackCorrect ? "#2d6a4f" : "#9b2226";
  }
}

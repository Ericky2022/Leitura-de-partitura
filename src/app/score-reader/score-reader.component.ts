import { CommonModule } from "@angular/common";
import {
  Component,
  ElementRef,
  EventEmitter,
  OnDestroy,
  Output,
  QueryList,
  ViewChildren,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { DomSanitizer, SafeResourceUrl } from "@angular/platform-browser";

interface ParsedScoreNote {
  label: string;
  frequency: number | null;
  beats: number;
  isRest?: boolean;
}

interface ScoreSystem {
  startIndex: number;
  notes: ParsedScoreNote[];
}

@Component({
  selector: "app-score-reader",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./score-reader.component.html",
  styleUrl: "./score-reader.component.css",
})
export class ScoreReaderComponent implements OnDestroy {
  @Output() back = new EventEmitter<void>();
  @ViewChildren("scoreNoteSlot") scoreNoteSlots?: QueryList<
    ElementRef<HTMLElement>
  >;

  pdfName = "";
  pdfUrl: SafeResourceUrl | null = null;
  musicXmlName = "";
  isConvertingPdf = false;
  noteSequence = "Dó4 Ré4 Mi4 Fá4 Sol4 Sol4 Lá4 Sol4 Fá4 Mi4 Ré4 Dó4";
  tempo = 90;
  isPlaying = false;
  currentNoteIndex = -1;
  statusMessage = "";

  private objectUrl = "";
  private audioContext?: AudioContext;
  private activeOscillator?: OscillatorNode;
  private playTimeout?: ReturnType<typeof setTimeout>;
  private playRunId = 0;

  private readonly noteFrequencyByName: Record<string, number> = {
    c3: 130.81,
    "do3": 130.81,
    "dó3": 130.81,
    d3: 146.83,
    re3: 146.83,
    "ré3": 146.83,
    e3: 164.81,
    mi3: 164.81,
    f3: 174.61,
    fa3: 174.61,
    "fá3": 174.61,
    g3: 196,
    sol3: 196,
    a3: 220,
    la3: 220,
    "lá3": 220,
    b3: 246.94,
    si3: 246.94,
    c4: 261.63,
    "do4": 261.63,
    "dó4": 261.63,
    d4: 293.66,
    re4: 293.66,
    "ré4": 293.66,
    e4: 329.63,
    mi4: 329.63,
    f4: 349.23,
    fa4: 349.23,
    "fá4": 349.23,
    g4: 392,
    sol4: 392,
    a4: 440,
    la4: 440,
    "lá4": 440,
    b4: 493.88,
    si4: 493.88,
    c5: 523.25,
    "do5": 523.25,
    "dó5": 523.25,
    d5: 587.33,
    re5: 587.33,
    "ré5": 587.33,
    e5: 659.25,
    mi5: 659.25,
    f5: 698.46,
    fa5: 698.46,
    "fá5": 698.46,
    g5: 783.99,
    sol5: 783.99,
    a5: 880,
    la5: 880,
    "lá5": 880,
    b5: 987.77,
    si5: 987.77,
  };

  constructor(private readonly sanitizer: DomSanitizer) {}

  get parsedNotes(): ParsedScoreNote[] {
    return this.parseSequence();
  }

  get canPlay(): boolean {
    return this.parsedNotes.length > 0 && !this.isPlaying && !this.isConvertingPdf;
  }

  get scoreSystems(): ScoreSystem[] {
    const notesPerSystem = 12;
    const notes = this.parsedNotes;
    const systems: ScoreSystem[] = [];

    for (let index = 0; index < notes.length; index += notesPerSystem) {
      systems.push({
        startIndex: index,
        notes: notes.slice(index, index + notesPerSystem),
      });
    }

    return systems;
  }

  get currentPlayingNoteLabel(): string {
    if (this.currentNoteIndex < 0) {
      return "";
    }

    return this.parsedNotes[this.currentNoteIndex]?.label ?? "";
  }

  get playbackProgressPercent(): number {
    const noteCount = this.parsedNotes.length;

    if (noteCount === 0 || this.currentNoteIndex < 0) {
      return 0;
    }

    return Math.min(100, ((this.currentNoteIndex + 1) / noteCount) * 100);
  }

  get currentNotePositionLabel(): string {
    const noteCount = this.parsedNotes.length;

    if (noteCount === 0) {
      return "0/0";
    }

    return `${Math.max(0, this.currentNoteIndex + 1)}/${noteCount}`;
  }

  getNoteTop(note: ParsedScoreNote): number {
    if (note.isRest) {
      return 42;
    }

    const noteMatch = /^(Dó|Ré|Mi|Fá|Sol|Lá|Si)(?:#|b)?([0-8])$/i.exec(
      note.label,
    );

    if (!noteMatch) {
      return 42;
    }

    const stepByName: Record<string, number> = {
      "dó": 0,
      ré: 1,
      mi: 2,
      fá: 3,
      sol: 4,
      lá: 5,
      si: 6,
    };
    const step = stepByName[noteMatch[1].toLocaleLowerCase("pt-BR")];
    const octave = Number(noteMatch[2]);

    if (step === undefined || !Number.isFinite(octave)) {
      return 42;
    }

    const bottomLineE4 = 4 * 7 + 2;
    const notePosition = octave * 7 + step;
    const staffHalfStep = 7;
    const bottomLineY = 76;

    return bottomLineY - (notePosition - bottomLineE4) * staffHalfStep - 10;
  }

  getNoteMark(note: ParsedScoreNote): string {
    if (note.isRest) {
      return "𝄽";
    }

    return note.beats >= 4 ? "𝅝" : note.beats >= 2 ? "𝅗𝅥" : "♩";
  }

  isCurrentScoreNote(system: ScoreSystem, noteIndex: number): boolean {
    return this.currentNoteIndex === system.startIndex + noteIndex;
  }

  selectScoreNote(index: number): void {
    if (index < 0 || index >= this.parsedNotes.length) {
      return;
    }

    this.currentNoteIndex = index;
    this.statusMessage = `Nota selecionada: ${this.parsedNotes[index].label}`;
    this.scrollCurrentNoteIntoView();

    if (this.isPlaying) {
      const notes = this.parsedNotes;
      const runId = ++this.playRunId;
      this.stopActiveNote();

      if (this.playTimeout) {
        clearTimeout(this.playTimeout);
        this.playTimeout = undefined;
      }

      void this.playNoteAtIndex(notes, index, runId);
    }
  }

  restartScore(): void {
    this.stopScore();
    this.currentNoteIndex = -1;
    void this.playScore(0);
  }

  async handleScoreFileSelection(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    if (this.isPdfFile(file)) {
      await this.loadPdf(file);
      return;
    }

    if (this.isMusicXmlFile(file)) {
      await this.loadMusicXml(file);
      return;
    }

    this.statusMessage = "Selecione um arquivo PDF, MusicXML ou XML.";
    input.value = "";
  }

  private async loadPdf(file: File): Promise<void> {
    this.revokePdfUrl();
    this.pdfName = file.name;
    this.objectUrl = URL.createObjectURL(file);
    this.pdfUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
      this.objectUrl,
    );
    this.statusMessage = "PDF carregado. Lendo a partitura...";
    await this.convertPdfToMusicXml(file);
  }

  private async loadMusicXml(file: File): Promise<void> {
    try {
      const xml = await file.text();
      const notes = this.parseMusicXml(xml);

      if (notes.length === 0) {
        this.statusMessage =
          "Não encontrei notas tocáveis nesse MusicXML. Verifique o arquivo.";
        return;
      }

      this.musicXmlName = file.name;
      this.noteSequence = this.formatNotesForSequence(notes);
      this.statusMessage = `MusicXML carregado com ${notes.length} eventos musicais.`;
    } catch {
      this.statusMessage =
        "Não foi possível ler o MusicXML. Tente exportar novamente como .musicxml ou .xml.";
    }
  }

  private async convertPdfToMusicXml(file: File): Promise<void> {
    this.isConvertingPdf = true;

    try {
      const response = await fetch(
        "http://localhost:3001/api/score-reader/convert-pdf",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/pdf",
          },
          body: file,
        },
      );
      const data = (await response.json()) as {
        fileName?: string;
        musicXml?: string;
        message?: string;
      };

      if (!response.ok || !data.musicXml) {
        this.statusMessage =
          data.message ??
          "Nao foi possivel ler o PDF automaticamente. Envie tambem o MusicXML.";
        return;
      }

      const notes = this.parseMusicXml(data.musicXml);

      if (notes.length === 0) {
        this.statusMessage =
          "O PDF foi convertido, mas nao encontrei notas tocaveis.";
        return;
      }

      this.musicXmlName = data.fileName ?? "convertido-do-pdf.xml";
      this.noteSequence = this.formatNotesForSequence(notes);
      this.statusMessage = `PDF lido com ${notes.length} eventos musicais. Clique em reproduzir.`;
    } catch {
      this.statusMessage =
        "PDF carregado, mas a leitura automatica precisa da API local com Audiveris em execucao.";
    } finally {
      this.isConvertingPdf = false;
    }
  }

  private formatNotesForSequence(notes: ParsedScoreNote[]): string {
    return notes
      .map((note) => `${note.label}${note.beats === 1 ? "" : `:${note.beats}`}`)
      .join(" ");
  }

  private isPdfFile(file: File): boolean {
    return (
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
    );
  }

  private isMusicXmlFile(file: File): boolean {
    const fileName = file.name.toLowerCase();

    return (
      fileName.endsWith(".musicxml") ||
      fileName.endsWith(".xml") ||
      file.type === "application/xml" ||
      file.type === "text/xml" ||
      file.type === "application/vnd.recordare.musicxml+xml"
    );
  }

  private parseMusicXml(xml: string): ParsedScoreNote[] {
    const documentXml = new DOMParser().parseFromString(xml, "application/xml");

    if (documentXml.querySelector("parsererror")) {
      throw new Error("Invalid MusicXML");
    }

    const part = documentXml.querySelector("part");
    if (!part) {
      return [];
    }

    const notes: ParsedScoreNote[] = [];
    let divisions = 1;

    for (const measure of Array.from(part.querySelectorAll("measure"))) {
      const divisionsText = measure.querySelector("attributes > divisions")
        ?.textContent;
      const nextDivisions = Number(divisionsText);

      if (Number.isFinite(nextDivisions) && nextDivisions > 0) {
        divisions = nextDivisions;
      }

      for (const noteElement of Array.from(measure.querySelectorAll("note"))) {
        if (noteElement.querySelector("chord")) {
          continue;
        }

        const duration = this.readMusicXmlDuration(noteElement, divisions);
        const isRest = Boolean(noteElement.querySelector("rest"));

        if (isRest) {
          notes.push({
            label: "Pausa",
            frequency: null,
            beats: duration,
            isRest: true,
          });
          continue;
        }

        const step = noteElement.querySelector("pitch > step")?.textContent;
        const octave = noteElement.querySelector("pitch > octave")?.textContent;
        const alter = Number(
          noteElement.querySelector("pitch > alter")?.textContent ?? 0,
        );

        if (!step || !octave) {
          continue;
        }

        const octaveNumber = Number(octave);
        if (!Number.isFinite(octaveNumber)) {
          continue;
        }

        notes.push({
          label: this.formatMusicXmlLabel(step, alter, octaveNumber),
          frequency: this.frequencyFromPitch(step, alter, octaveNumber),
          beats: duration,
        });
      }
    }

    return notes;
  }

  private readMusicXmlDuration(noteElement: Element, divisions: number): number {
    const durationText = noteElement.querySelector("duration")?.textContent;
    const duration = Number(durationText);

    if (Number.isFinite(duration) && duration > 0) {
      return Math.max(0.25, duration / Math.max(1, divisions));
    }

    const type = noteElement.querySelector("type")?.textContent?.trim();
    const durationsByType: Record<string, number> = {
      whole: 4,
      half: 2,
      quarter: 1,
      eighth: 0.5,
      "16th": 0.25,
    };

    return durationsByType[type ?? ""] ?? 1;
  }

  private frequencyFromPitch(
    step: string,
    alter: number,
    octave: number,
  ): number {
    const semitoneByStep: Record<string, number> = {
      C: 0,
      D: 2,
      E: 4,
      F: 5,
      G: 7,
      A: 9,
      B: 11,
    };
    const semitone = semitoneByStep[step.toUpperCase()];

    if (semitone === undefined) {
      return 440;
    }

    const midiNumber = (octave + 1) * 12 + semitone + alter;
    return 440 * 2 ** ((midiNumber - 69) / 12);
  }

  private formatMusicXmlLabel(
    step: string,
    alter: number,
    octave: number,
  ): string {
    const noteLabelByStep: Record<string, string> = {
      C: "Dó",
      D: "Ré",
      E: "Mi",
      F: "Fá",
      G: "Sol",
      A: "Lá",
      B: "Si",
    };
    const accidental = alter > 0 ? "#" : alter < 0 ? "b" : "";

    return `${noteLabelByStep[step.toUpperCase()] ?? step}${accidental}${octave}`;
  }

  private parseMusicXmlLabelToken(token: string): ParsedScoreNote | null {
    const match = /^(Dó|Ré|Mi|Fá|Sol|Lá|Si)(#|b)?([0-8])$/i.exec(token);

    if (!match) {
      return null;
    }

    const stepByLabel: Record<string, string> = {
      "dó": "C",
      ré: "D",
      mi: "E",
      fá: "F",
      sol: "G",
      lá: "A",
      si: "B",
    };
    const step = stepByLabel[match[1].toLocaleLowerCase("pt-BR")];

    if (!step) return null;

    const alter = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
    const octave = Number(match[3]);

    return {
      label: this.formatMusicXmlLabel(step, alter, octave),
      frequency: this.frequencyFromPitch(step, alter, octave),
      beats: 1,
    };
  }

  async playScore(startIndex = this.currentNoteIndex >= 0 ? this.currentNoteIndex : 0): Promise<void> {
    const notes = this.parsedNotes;

    if (notes.length === 0 || this.isPlaying) {
      this.statusMessage =
        "Digite uma sequência com notas como Dó4 Ré4 Mi4 ou C4 D4 E4.";
      return;
    }

    this.audioContext ??= new AudioContext();
    await this.audioContext.resume();

    this.isPlaying = true;
    this.statusMessage = "Reproduzindo partitura.";
    const runId = ++this.playRunId;
    void this.playNoteAtIndex(notes, startIndex, runId);
  }

  stopScore(): void {
    this.playRunId++;
    this.isPlaying = false;
    this.currentNoteIndex = -1;
    this.statusMessage = "Reprodução parada.";
    this.stopActiveNote();

    if (this.playTimeout) {
      clearTimeout(this.playTimeout);
      this.playTimeout = undefined;
    }
  }

  goBack(): void {
    this.stopScore();
    this.back.emit();
  }

  private async playNoteAtIndex(
    notes: ParsedScoreNote[],
    index: number,
    runId: number,
  ): Promise<void> {
    if (!this.audioContext || runId !== this.playRunId) {
      return;
    }

    if (index >= notes.length) {
      this.isPlaying = false;
      this.currentNoteIndex = -1;
      this.statusMessage = "Reprodução concluída.";
      return;
    }

    const note = notes[index];
    const beatDurationMs = 60000 / Math.max(40, Math.min(180, this.tempo));
    const durationMs = beatDurationMs * note.beats;

    this.currentNoteIndex = index;
    this.scrollCurrentNoteIntoView();
    this.stopActiveNote();
    if (note.frequency !== null) {
      this.playFrequency(note.frequency, durationMs / 1000);
    }

    this.playTimeout = setTimeout(() => {
      void this.playNoteAtIndex(notes, index + 1, runId);
    }, durationMs);
  }

  private playFrequency(frequency: number, durationSeconds: number): void {
    if (!this.audioContext) {
      return;
    }

    const oscillator = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    const now = this.audioContext.currentTime;
    const end = now + durationSeconds;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.42, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      Math.max(now + 0.04, end - 0.04),
    );

    oscillator.connect(gain);
    gain.connect(this.audioContext.destination);
    oscillator.start(now);
    oscillator.stop(end);
    this.activeOscillator = oscillator;
  }

  private stopActiveNote(): void {
    if (!this.activeOscillator) {
      return;
    }

    try {
      this.activeOscillator.stop();
    } catch {
      // A nota pode ja ter terminado.
    }

    this.activeOscillator.disconnect();
    this.activeOscillator = undefined;
  }

  private scrollCurrentNoteIntoView(): void {
    setTimeout(() => {
      if (this.currentNoteIndex < 0) {
        return;
      }

      const noteElement = this.scoreNoteSlots
        ?.toArray()
        [this.currentNoteIndex]?.nativeElement;

      noteElement?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }, 0);
  }

  private parseSequence(): ParsedScoreNote[] {
    return this.noteSequence
      .split(/[\s,;|]+/)
      .map((token) => token.trim())
      .filter(Boolean)
      .map((token) => this.parseToken(token))
      .filter((note): note is ParsedScoreNote => note !== null);
  }

  private parseToken(token: string): ParsedScoreNote | null {
    const match = /^([a-gA-G]|do|dó|re|ré|mi|fa|fá|sol|la|lá|si|pausa|rest)(#|b)?([0-8])?(?:[:/](0\.25|0\.5|1|2|4))?$/i.exec(
      token,
    );

    if (!match) {
      return null;
    }

    const noteName = match[1].toLocaleLowerCase("pt-BR");
    const accidental = match[2] ?? "";
    const octave = match[3] ?? "4";
    const beats = Number(match[4] ?? 1);

    if (noteName === "pausa" || noteName === "rest") {
      return {
        label: "Pausa",
        frequency: null,
        beats,
        isRest: true,
      };
    }

    if (accidental) {
      const parsedMusicXmlLabel = this.parseMusicXmlLabelToken(
        `${this.formatNoteName(noteName)}${accidental}${octave}`,
      );

      return parsedMusicXmlLabel
        ? {
            ...parsedMusicXmlLabel,
            beats,
          }
        : null;
    }

    const key = `${noteName}${octave}`;
    const frequency = this.noteFrequencyByName[key];

    if (!frequency) {
      return null;
    }

    return {
      label: `${this.formatNoteName(noteName)}${octave}`,
      frequency,
      beats,
    };
  }

  private formatNoteName(noteName: string): string {
    const labels: Record<string, string> = {
      c: "Dó",
      do: "Dó",
      "dó": "Dó",
      d: "Ré",
      re: "Ré",
      "ré": "Ré",
      e: "Mi",
      mi: "Mi",
      f: "Fá",
      fa: "Fá",
      "fá": "Fá",
      g: "Sol",
      sol: "Sol",
      a: "Lá",
      la: "Lá",
      "lá": "Lá",
      b: "Si",
      si: "Si",
    };

    return labels[noteName] ?? noteName;
  }

  private revokePdfUrl(): void {
    if (!this.objectUrl) {
      return;
    }

    URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = "";
  }

  ngOnDestroy(): void {
    this.stopScore();
    this.revokePdfUrl();
    void this.audioContext?.close();
  }
}

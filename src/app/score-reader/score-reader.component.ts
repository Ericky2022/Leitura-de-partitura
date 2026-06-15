import { CommonModule } from "@angular/common";
import {
  Component,
  ElementRef,
  EventEmitter,
  OnDestroy,
  Output,
  ViewChild,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { DomSanitizer, SafeResourceUrl } from "@angular/platform-browser";
import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";

interface ParsedScoreNote {
  label: string;
  frequency: number | null;
  beats: number;
  measureNumber?: number;
  isRest?: boolean;
  cursorStep?: number;
}

interface ParsedScoreMeasure {
  notes: ParsedScoreNote[];
  hasForwardRepeat: boolean;
  hasBackwardRepeat: boolean;
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
  @ViewChild("osmdContainer") osmdContainer?: ElementRef<HTMLElement>;

  pdfName = "";
  pdfUrl: SafeResourceUrl | null = null;
  musicXmlName = "";
  isConvertingPdf = false;
  noteSequence = "";
  tempo = 90;
  isPlaying = false;
  currentNoteIndex = -1;
  statusMessage = "";
  isPresentationMode = false;
  pdfZoom = 100;
  hasRenderedScore = false;

  private objectUrl = "";
  private audioContext?: AudioContext;
  private activeOscillator?: OscillatorNode;
  private playTimeout?: ReturnType<typeof setTimeout>;
  private playRunId = 0;
  private osmd?: OpenSheetMusicDisplay;
  private currentMusicXml = "";
  private playbackNotes: ParsedScoreNote[] = [];

  private readonly noteFrequencyByName: Record<string, number> = {
    c3: 130.81, do3: 130.81, dó3: 130.81, d3: 146.83, re3: 146.83, ré3: 146.83,
    e3: 164.81, mi3: 164.81, f3: 174.61, fa3: 174.61, fá3: 174.61, g3: 196,
    sol3: 196, a3: 220, la3: 220, lá3: 220, b3: 246.94, si3: 246.94,
    c4: 261.63, do4: 261.63, dó4: 261.63, d4: 293.66, re4: 293.66, ré4: 293.66,
    e4: 329.63, mi4: 329.63, f4: 349.23, fa4: 349.23, fá4: 349.23, g4: 392,
    sol4: 392, a4: 440, la4: 440, lá4: 440, b4: 493.88, si4: 493.88,
    c5: 523.25, do5: 523.25, dó5: 523.25, d5: 587.33, re5: 587.33, ré5: 587.33,
    e5: 659.25, mi5: 659.25, f5: 698.46, fa5: 698.46, fá5: 698.46, g5: 783.99,
    sol5: 783.99, a5: 880, la5: 880, lá5: 880, b5: 987.77, si5: 987.77,
  };

  constructor(private readonly sanitizer: DomSanitizer) {}

  get parsedNotes(): ParsedScoreNote[] {
    return this.playbackNotes.length > 0 ? this.playbackNotes : this.parseSequence();
  }

  get canPlay(): boolean {
    return this.parsedNotes.length > 0 && !this.isPlaying && !this.isConvertingPdf;
  }

  get selectedScoreDisplayName(): string {
    return this.pdfName || this.musicXmlName || "partitura selecionada";
  }

  get currentPlayingNoteLabel(): string {
    if (this.currentNoteIndex < 0) return "";
    return this.parsedNotes[this.currentNoteIndex]?.label ?? "";
  }

  get pdfViewerTransform(): string {
    return `scale(${this.pdfZoom / 100})`;
  }

  get playbackProgressPercent(): number {
    const noteCount = this.parsedNotes.length;
    if (noteCount === 0 || this.currentNoteIndex < 0) return 0;
    return Math.min(100, ((this.currentNoteIndex + 1) / noteCount) * 100);
  }

  get currentMeasureNumber(): number {
    if (this.currentNoteIndex < 0) return 0;
    return this.parsedNotes[this.currentNoteIndex]?.measureNumber ?? 0;
  }

  get measureCount(): number {
    return Math.max(0, ...this.parsedNotes.map((note) => note.measureNumber ?? 0));
  }

  get currentMeasureLabel(): string {
    if (this.currentMeasureNumber === 0) {
      return this.measureCount > 0 ? `Compasso 1/${this.measureCount}` : "Compasso 0/0";
    }
    return `Compasso ${this.currentMeasureNumber}/${this.measureCount || this.currentMeasureNumber}`;
  }

  get currentNotePositionLabel(): string {
    const noteCount = this.parsedNotes.length;
    if (noteCount === 0) return "0/0";
    return `${Math.max(0, this.currentNoteIndex + 1)}/${noteCount}`;
  }

  async handleScoreFileSelection(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.stopScore();
    this.clearRenderedScore();

    if (this.isPdfFile(file)) {
      await this.loadPdf(file);
      input.value = "";
      return;
    }

    if (this.isMusicXmlFile(file)) {
      await this.loadMusicXml(file);
      input.value = "";
      return;
    }

    this.statusMessage = "Selecione um arquivo PDF, MusicXML ou XML.";
    input.value = "";
  }

  togglePresentationMode(): void {
    this.isPresentationMode = !this.isPresentationMode;
    this.statusMessage = this.isPresentationMode
      ? "Modo apresentação ativado para tocar acompanhando a partitura."
      : "Modo apresentação encerrado.";
  }

  changePdfZoom(delta: number): void {
    this.pdfZoom = Math.max(45, Math.min(150, this.pdfZoom + delta));
  }

  restartScore(): void {
    this.stopScore();
    this.currentNoteIndex = -1;
    void this.playScore(0);
  }

  async playScore(startIndex = this.currentNoteIndex >= 0 ? this.currentNoteIndex : 0): Promise<void> {
    const notes = this.parsedNotes;
    if (notes.length === 0 || this.isPlaying) {
      this.statusMessage = "Envie uma partitura com notas reconhecidas antes de reproduzir.";
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
    this.stopActiveNote();
    this.resetOsmdCursor();

    if (this.playTimeout) {
      clearTimeout(this.playTimeout);
      this.playTimeout = undefined;
    }
  }

  goBack(): void {
    this.stopScore();
    this.back.emit();
  }

  private async loadPdf(file: File): Promise<void> {
    this.revokePdfUrl();
    this.isPresentationMode = true;
    this.pdfName = file.name;
    this.musicXmlName = "";
    this.objectUrl = URL.createObjectURL(file);
    this.pdfUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.objectUrl);
    this.noteSequence = "";
    this.playbackNotes = [];
    this.currentNoteIndex = -1;
    this.statusMessage = "PDF carregado. Convertendo para partitura interativa...";
    await this.convertPdfToMusicXml(file);
  }

  private async loadMusicXml(file: File): Promise<void> {
    this.revokePdfUrl();
    this.pdfName = "";
    this.pdfUrl = null;
    this.noteSequence = "";
    this.playbackNotes = [];
    this.currentNoteIndex = -1;
    this.isPresentationMode = true;

    try {
      const xml = await file.text();
      const notes = this.parseMusicXml(xml);
      if (notes.length === 0) {
        this.statusMessage = "Não encontrei notas tocáveis nesse MusicXML. Confira se o arquivo foi exportado corretamente.";
        return;
      }
      this.musicXmlName = file.name;
      this.playbackNotes = notes;
      this.noteSequence = this.formatNotesForSequence(notes);
      await this.renderMusicXml(xml);
      this.statusMessage = `MusicXML carregado com ${notes.length} eventos musicais. Retornelos serão tocados uma vez.`;
    } catch {
      this.statusMessage = "Não foi possível ler o MusicXML. Tente exportar novamente como .musicxml ou .xml.";
    }
  }

  private async convertPdfToMusicXml(file: File): Promise<void> {
    this.isConvertingPdf = true;

    try {
      const response = await fetch("http://localhost:3001/api/score-reader/convert-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: file,
      });
      const data = (await response.json()) as { fileName?: string; musicXml?: string; message?: string };

      if (!response.ok || !data.musicXml) {
        this.statusMessage = data.message ?? "Não foi possível ler o PDF automaticamente. Envie também o MusicXML exportado da partitura.";
        return;
      }

      const notes = this.parseMusicXml(data.musicXml);
      if (notes.length === 0) {
        this.statusMessage = "O PDF foi convertido, mas não encontrei notas tocáveis. Tente um PDF mais limpo ou exporte MusicXML.";
        return;
      }

      this.musicXmlName = data.fileName ?? "convertido-do-pdf.xml";
      this.playbackNotes = notes;
      this.noteSequence = this.formatNotesForSequence(notes);
      await this.renderMusicXml(data.musicXml);
      this.statusMessage = `PDF convertido com ${notes.length} eventos musicais. Retornelos serão tocados uma vez.`;
    } catch {
      this.statusMessage = "PDF carregado, mas a leitura automática precisa da API local com Audiveris em execução.";
    } finally {
      this.isConvertingPdf = false;
    }
  }

  private async renderMusicXml(xml: string): Promise<void> {
    this.currentMusicXml = xml;
    this.hasRenderedScore = true;
    this.applyResponsiveScoreZoom();
    await new Promise((resolve) => setTimeout(resolve));

    const container = this.osmdContainer?.nativeElement;
    if (!container) {
      this.statusMessage = "A área de partitura ainda não está pronta. Tente carregar novamente.";
      return;
    }

    container.innerHTML = "";
    container.style.transformOrigin = "top left";
    this.osmd = new OpenSheetMusicDisplay(container, {
      autoResize: true,
      drawTitle: true,
      drawingParameters: "compacttight",
      followCursor: true,
    });

    await this.osmd.load(this.currentMusicXml);
    this.osmd.render();
    this.resetOsmdCursor();
  }

  private applyResponsiveScoreZoom(): void {
    const width = window.innerWidth;
    if (width <= 430) {
      this.pdfZoom = 55;
      return;
    }

    if (width <= 760) {
      this.pdfZoom = 65;
      return;
    }

    this.pdfZoom = 100;
  }

  private clearRenderedScore(): void {
    this.currentMusicXml = "";
    this.hasRenderedScore = false;
    this.playbackNotes = [];
    this.osmd = undefined;
    if (this.osmdContainer?.nativeElement) {
      this.osmdContainer.nativeElement.innerHTML = "";
    }
  }

  private formatNotesForSequence(notes: ParsedScoreNote[]): string {
    return notes
      .map((note) => {
        const duration = note.beats === 1 ? "" : `:${note.beats}`;
        const measure = note.measureNumber ? `@${note.measureNumber}` : "";
        return `${note.label}${duration}${measure}`;
      })
      .join(" ");
  }

  private isPdfFile(file: File): boolean {
    return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
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
    if (documentXml.querySelector("parsererror")) throw new Error("Invalid MusicXML");

    const parts = Array.from(documentXml.querySelectorAll("part"));
    if (parts.length === 0) return [];

    const notesByPart = parts.map((part) => this.parseMusicXmlPart(part));
    const playableParts = notesByPart.filter((notes) => notes.some((note) => !note.isRest));
    if (playableParts.length === 0) return notesByPart[0] ?? [];

    return playableParts.reduce((largestPart, currentPart) =>
      currentPart.filter((note) => !note.isRest).length > largestPart.filter((note) => !note.isRest).length
        ? currentPart
        : largestPart,
    );
  }

  private parseMusicXmlPart(part: Element): ParsedScoreNote[] {
    const parsedMeasures: ParsedScoreMeasure[] = [];
    let divisions = 1;
    let cursorStep = 0;

    for (const [measureIndex, measure] of Array.from(part.querySelectorAll("measure")).entries()) {
      const measureNumber = Number(measure.getAttribute("number")) || measureIndex + 1;
      const divisionsText = measure.querySelector("attributes > divisions")?.textContent;
      const nextDivisions = Number(divisionsText);
      if (Number.isFinite(nextDivisions) && nextDivisions > 0) divisions = nextDivisions;

      const measureNotes: ParsedScoreNote[] = [];

      for (const noteElement of Array.from(measure.querySelectorAll("note"))) {
        const duration = this.readMusicXmlDuration(noteElement, divisions);
        if (this.shouldSkipMusicXmlNote(noteElement)) continue;

        const isRest = Boolean(noteElement.querySelector("rest"));
        if (isRest) {
          measureNotes.push({ label: "Pausa", frequency: null, beats: duration, measureNumber, isRest: true, cursorStep });
          cursorStep++;
          continue;
        }

        const step = noteElement.querySelector("pitch > step")?.textContent;
        const octave = noteElement.querySelector("pitch > octave")?.textContent;
        const alter = Number(noteElement.querySelector("pitch > alter")?.textContent ?? 0);
        if (!step || !octave) continue;

        const octaveNumber = Number(octave);
        if (!Number.isFinite(octaveNumber)) continue;

        measureNotes.push({
          label: this.formatMusicXmlLabel(step, alter, octaveNumber),
          frequency: this.frequencyFromPitch(step, alter, octaveNumber),
          beats: duration,
          measureNumber,
          cursorStep,
        });
        this.mergeTiedNoteDuration(measureNotes, noteElement);
        cursorStep++;
      }

      parsedMeasures.push({
        notes: measureNotes,
        hasForwardRepeat: this.hasRepeatDirection(measure, "forward"),
        hasBackwardRepeat: this.hasRepeatDirection(measure, "backward"),
      });
    }

    return this.expandRepeatsOnce(parsedMeasures);
  }

  private expandRepeatsOnce(measures: ParsedScoreMeasure[]): ParsedScoreNote[] {
    const expandedNotes: ParsedScoreNote[] = [];
    let repeatStartMeasureIndex = 0;

    for (let measureIndex = 0; measureIndex < measures.length; measureIndex++) {
      const measure = measures[measureIndex];

      if (measure.hasForwardRepeat) {
        repeatStartMeasureIndex = measureIndex;
      }

      expandedNotes.push(...this.cloneNotes(measure.notes));

      if (measure.hasBackwardRepeat) {
        for (let repeatIndex = repeatStartMeasureIndex; repeatIndex <= measureIndex; repeatIndex++) {
          expandedNotes.push(...this.cloneNotes(measures[repeatIndex].notes));
        }
        repeatStartMeasureIndex = measureIndex + 1;
      }
    }

    return expandedNotes;
  }

  private cloneNotes(notes: ParsedScoreNote[]): ParsedScoreNote[] {
    return notes.map((note) => ({ ...note }));
  }

  private hasRepeatDirection(measure: Element, direction: "forward" | "backward"): boolean {
    return Array.from(measure.querySelectorAll("barline repeat")).some(
      (repeat) => repeat.getAttribute("direction") === direction,
    );
  }

  private shouldSkipMusicXmlNote(noteElement: Element): boolean {
    return Boolean(noteElement.querySelector("chord"));
  }

  private mergeTiedNoteDuration(notes: ParsedScoreNote[], noteElement: Element): void {
    const tieTypes = Array.from(noteElement.querySelectorAll("tie")).map((tie) => tie.getAttribute("type"));
    if (!tieTypes.includes("stop") || notes.length < 2) return;

    const currentNote = notes.at(-1);
    const previousNote = notes.at(-2);
    if (currentNote && previousNote && !currentNote.isRest && !previousNote.isRest && currentNote.label === previousNote.label) {
      previousNote.beats += currentNote.beats;
      notes.pop();
    }
  }

  private readMusicXmlDuration(noteElement: Element, divisions: number): number {
    const type = noteElement.querySelector("type")?.textContent?.trim();
    const durationsByType: Record<string, number> = {
      breve: 8,
      whole: 4,
      half: 2,
      quarter: 1,
      eighth: 0.5,
      "16th": 0.25,
      "32nd": 0.125,
    };

    const baseDuration = durationsByType[type ?? ""];
    if (baseDuration !== undefined) {
      return Math.max(0.125, this.applyDotsAndTuplet(baseDuration, noteElement));
    }

    const durationText = noteElement.querySelector("duration")?.textContent;
    const duration = Number(durationText);
    if (Number.isFinite(duration) && duration > 0) {
      return Math.max(0.125, duration / Math.max(1, divisions));
    }

    return 1;
  }

  private applyDotsAndTuplet(baseDuration: number, noteElement: Element): number {
    const dotCount = noteElement.querySelectorAll("dot").length;
    let duration = baseDuration;
    let dotValue = baseDuration / 2;
    for (let index = 0; index < dotCount; index++) {
      duration += dotValue;
      dotValue /= 2;
    }

    const actualNotes = Number(noteElement.querySelector("time-modification > actual-notes")?.textContent);
    const normalNotes = Number(noteElement.querySelector("time-modification > normal-notes")?.textContent);
    if (Number.isFinite(actualNotes) && Number.isFinite(normalNotes) && actualNotes > 0 && normalNotes > 0) {
      duration *= normalNotes / actualNotes;
    }

    return duration;
  }

  private frequencyFromPitch(step: string, alter: number, octave: number): number {
    const semitoneByStep: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    const semitone = semitoneByStep[step.toUpperCase()];
    if (semitone === undefined) return 440;
    const midiNumber = (octave + 1) * 12 + semitone + alter;
    return 440 * 2 ** ((midiNumber - 69) / 12);
  }

  private formatMusicXmlLabel(step: string, alter: number, octave: number): string {
    const noteLabelByStep: Record<string, string> = { C: "Dó", D: "Ré", E: "Mi", F: "Fá", G: "Sol", A: "Lá", B: "Si" };
    const accidental = alter > 0 ? "#" : alter < 0 ? "b" : "";
    return `${noteLabelByStep[step.toUpperCase()] ?? step}${accidental}${octave}`;
  }

  private parseMusicXmlLabelToken(token: string): ParsedScoreNote | null {
    const match = /^(Dó|Ré|Mi|Fá|Sol|Lá|Si)(#|b)?([0-8])$/i.exec(token);
    if (!match) return null;

    const stepByLabel: Record<string, string> = { dó: "C", ré: "D", mi: "E", fá: "F", sol: "G", lá: "A", si: "B" };
    const step = stepByLabel[match[1].toLocaleLowerCase("pt-BR")];
    if (!step) return null;

    const alter = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
    const octave = Number(match[3]);
    return { label: this.formatMusicXmlLabel(step, alter, octave), frequency: this.frequencyFromPitch(step, alter, octave), beats: 1 };
  }

  private async playNoteAtIndex(notes: ParsedScoreNote[], index: number, runId: number): Promise<void> {
    if (!this.audioContext || runId !== this.playRunId) return;

    if (index >= notes.length) {
      this.isPlaying = false;
      this.currentNoteIndex = -1;
      this.statusMessage = "Reprodução concluída.";
      this.resetOsmdCursor();
      return;
    }

    const note = notes[index];
    const beatDurationMs = 60000 / Math.max(40, Math.min(180, this.tempo));
    const durationMs = Math.max(80, beatDurationMs * note.beats);

    this.currentNoteIndex = index;
    this.moveOsmdCursorTo(note.cursorStep ?? index);
    this.stopActiveNote();

    if (note.frequency !== null) this.playFrequency(note.frequency, durationMs / 1000);
    this.scrollPlayheadIntoView();

    this.playTimeout = setTimeout(() => {
      void this.playNoteAtIndex(notes, index + 1, runId);
    }, durationMs);
  }

  private playFrequency(frequency: number, durationSeconds: number): void {
    if (!this.audioContext) return;

    const oscillator = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    const now = this.audioContext.currentTime;
    const end = now + durationSeconds;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.42, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, Math.max(now + 0.04, end - 0.04));

    oscillator.connect(gain);
    gain.connect(this.audioContext.destination);
    oscillator.start(now);
    oscillator.stop(end);
    this.activeOscillator = oscillator;
  }

  private stopActiveNote(): void {
    if (!this.activeOscillator) return;
    try {
      this.activeOscillator.stop();
    } catch {
      // A nota pode ja ter terminado.
    }
    this.activeOscillator.disconnect();
    this.activeOscillator = undefined;
  }

  private moveOsmdCursorTo(cursorStep: number): void {
    const cursor = this.getOsmdCursor();
    if (!cursor) return;

    try {
      cursor.reset();
      cursor.show();
      for (let step = 0; step < cursorStep; step++) {
        cursor.next();
      }
    } catch {
      // Mantem a reproducao mesmo se o cursor nao conseguir sincronizar algum evento.
    }
  }

  private resetOsmdCursor(): void {
    const cursor = this.getOsmdCursor();
    if (!cursor) return;

    try {
      cursor.reset();
      cursor.show();
    } catch {
      // Cursor indisponivel em alguns arquivos MusicXML.
    }
  }

  private getOsmdCursor(): { reset: () => void; show: () => void; next: () => void } | null {
    return ((this.osmd as unknown as { cursor?: { reset: () => void; show: () => void; next: () => void } })?.cursor) ?? null;
  }

  private scrollPlayheadIntoView(): void {
    setTimeout(() => {
      const osmdCursor = this.osmdContainer?.nativeElement.querySelector<HTMLElement>(".OSMDCursor");
      const marker = osmdCursor ?? document.querySelector<HTMLElement>(".osmd-playhead");
      marker?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }, 0);
  }

  private parseSequence(): ParsedScoreNote[] {
    let inferredMeasure = 1;
    let beatsInMeasure = 0;

    return this.noteSequence
      .split(/[\s,;|]+/)
      .map((token) => token.trim())
      .filter(Boolean)
      .map((token) => this.parseToken(token))
      .filter((note): note is ParsedScoreNote => note !== null)
      .map((note) => {
        const noteWithMeasure = { ...note, measureNumber: note.measureNumber ?? inferredMeasure };
        if (note.measureNumber && note.measureNumber !== inferredMeasure) {
          inferredMeasure = note.measureNumber;
          beatsInMeasure = 0;
        }
        beatsInMeasure += note.beats;
        if (beatsInMeasure >= 4) {
          inferredMeasure += Math.floor(beatsInMeasure / 4);
          beatsInMeasure %= 4;
        }
        return noteWithMeasure;
      });
  }

  private parseToken(token: string): ParsedScoreNote | null {
    const match = /^([a-gA-G]|do|dó|re|ré|mi|fa|fá|sol|la|lá|si|pausa|rest)(#|b)?([0-8])?(?:[:/](0\.125|0\.25|0\.5|1|2|4|8))?(?:@(\d+))?$/i.exec(token);
    if (!match) return null;

    const noteName = match[1].toLocaleLowerCase("pt-BR");
    const accidental = match[2] ?? "";
    const octave = match[3] ?? "4";
    const beats = Number(match[4] ?? 1);
    const explicitMeasure = Number(match[5]);
    const measureNumber = Number.isFinite(explicitMeasure) && explicitMeasure > 0 ? explicitMeasure : undefined;

    if (noteName === "pausa" || noteName === "rest") {
      return { label: "Pausa", frequency: null, beats, measureNumber, isRest: true };
    }

    if (accidental) {
      const parsedMusicXmlLabel = this.parseMusicXmlLabelToken(`${this.formatNoteName(noteName)}${accidental}${octave}`);
      return parsedMusicXmlLabel ? { ...parsedMusicXmlLabel, beats, measureNumber } : null;
    }

    const key = `${noteName}${octave}`;
    const frequency = this.noteFrequencyByName[key];
    if (!frequency) return null;

    return { label: `${this.formatNoteName(noteName)}${octave}`, frequency, beats, measureNumber };
  }

  private formatNoteName(noteName: string): string {
    const labels: Record<string, string> = {
      c: "Dó", do: "Dó", dó: "Dó", d: "Ré", re: "Ré", ré: "Ré", e: "Mi", mi: "Mi",
      f: "Fá", fa: "Fá", fá: "Fá", g: "Sol", sol: "Sol", a: "Lá", la: "Lá", lá: "Lá", b: "Si", si: "Si",
    };
    return labels[noteName] ?? noteName;
  }

  private revokePdfUrl(): void {
    if (!this.objectUrl) return;
    URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = "";
  }

  ngOnDestroy(): void {
    this.stopScore();
    this.revokePdfUrl();
    void this.audioContext?.close();
  }
}

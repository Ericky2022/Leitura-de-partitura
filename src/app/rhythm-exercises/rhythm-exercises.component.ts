import { CommonModule } from "@angular/common";
import {
  Component,
  ElementRef,
  EventEmitter,
  OnDestroy,
  Output,
  ViewChild,
} from "@angular/core";

interface RhythmExercise {
  id: number;
  title: string;
  imageSrc: string;
  audioSrc: string;
}

@Component({
  selector: "app-rhythm-exercises",
  standalone: true,
  imports: [CommonModule],
  templateUrl: "./rhythm-exercises.component.html",
  styleUrl: "./rhythm-exercises.component.css",
})
export class RhythmExercisesComponent implements OnDestroy {
  @Output() back = new EventEmitter<void>();
  @ViewChild("referenceAudio") referenceAudio?: ElementRef<HTMLAudioElement>;

  readonly exercises: RhythmExercise[] = [
    {
      id: 1,
      title: "Exercicio 1",
      imageSrc: "assets/ritmo/exercicio1.PNG",
      audioSrc: "assets/ritmo/Exercício Ritmo1.mp3",
    },
  ];

  readonly similarityThreshold = 75;

  selectedExercise: RhythmExercise | null = null;
  currentExerciseIndex = -1;

  isRecording = false;
  isAnalyzing = false;
  comparisonDone = false;
  canProceed = false;
  recordedAudioUrl = "";
  comparisonMessage = "";
  similarityPercent: number | null = null;

  private mediaRecorder?: MediaRecorder;
  private stream?: MediaStream;
  private recordedChunks: Blob[] = [];
  private audioContext?: AudioContext;

  openExercise(exercise: RhythmExercise): void {
    this.resetComparisonState();
    this.releaseMicrophone();
    this.currentExerciseIndex = this.exercises.findIndex(
      (item) => item.id === exercise.id,
    );
    this.selectedExercise = exercise;
  }

  async startRecording(): Promise<void> {
    if (this.isRecording || this.isAnalyzing || !this.selectedExercise) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      this.comparisonMessage =
        "Este dispositivo nao suporta gravacao de audio no navegador.";
      return;
    }

    this.comparisonDone = false;
    this.canProceed = false;
    this.comparisonMessage = "";
    this.similarityPercent = null;
    this.recordedChunks = [];
    this.stopReferenceAudio();
    this.stopSpeechFeedback();

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      this.mediaRecorder = new MediaRecorder(this.stream);
      this.mediaRecorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      });

      this.mediaRecorder.addEventListener("stop", () => {
        void this.processRecordedAudio();
      });

      this.mediaRecorder.start();
      this.isRecording = true;
    } catch {
      this.comparisonMessage =
        "Nao foi possivel acessar o microfone. Verifique a permissao.";
      this.releaseMicrophone();
    }
  }

  stopRecording(): void {
    if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") {
      return;
    }

    this.mediaRecorder.stop();
    this.isRecording = false;
  }

  openNextExercise(): void {
    if (!this.canProceed) {
      return;
    }

    const nextExercise = this.exercises[this.currentExerciseIndex + 1];
    if (nextExercise) {
      this.openExercise(nextExercise);
      return;
    }

    this.closeExercise();
  }

  closeExercise(): void {
    this.stopReferenceAudio();
    this.releaseMicrophone();
    this.resetComparisonState();
    this.selectedExercise = null;
    this.currentExerciseIndex = -1;
  }

  goBack(): void {
    this.closeExercise();
    this.back.emit();
  }

  private async processRecordedAudio(): Promise<void> {
    const recordedBlob = new Blob(this.recordedChunks, {
      type: this.mediaRecorder?.mimeType || "audio/webm",
    });

    this.releaseMicrophone();

    if (!recordedBlob.size || !this.selectedExercise) {
      this.comparisonMessage =
        "A gravacao ficou vazia. Grave novamente para comparar.";
      return;
    }

    this.revokeRecordedAudioUrl();
    this.recordedAudioUrl = URL.createObjectURL(recordedBlob);
    await this.compareWithReference(
      recordedBlob,
      this.selectedExercise.audioSrc,
    );
  }

  private async compareWithReference(
    recordedBlob: Blob,
    referenceAudioSrc: string,
  ): Promise<void> {
    this.isAnalyzing = true;

    try {
      const [recordedBuffer, referenceBuffer] = await Promise.all([
        this.decodeBlobAudio(recordedBlob),
        this.decodeUrlAudio(referenceAudioSrc),
      ]);

      const similarityPercent = this.calculateSimilarityPercent(
        referenceBuffer,
        recordedBuffer,
      );

      this.comparisonDone = true;
      this.similarityPercent = Math.round(similarityPercent);
      if (similarityPercent >= this.similarityThreshold) {
        this.canProceed = true;
        this.comparisonMessage =
          "Muito bom! Pode seguir para o proximo exercicio.";
        this.speakFeedback("Muito bom! Seu ritmo esta correto.");
      } else {
        this.canProceed = false;
        this.comparisonMessage =
          "Ainda nao ficou parecido o suficiente. Grave novamente.";
        this.speakFeedback(
          "Ainda nao ficou igual a partitura. Tente gravar novamente.",
        );
      }
    } catch {
      this.comparisonDone = false;
      this.canProceed = false;
      this.similarityPercent = null;
      this.comparisonMessage =
        "Nao foi possivel comparar o audio agora. Tente gravar novamente.";
    } finally {
      this.isAnalyzing = false;
    }
  }

  private async decodeBlobAudio(blob: Blob): Promise<AudioBuffer> {
    const arrayBuffer = await blob.arrayBuffer();
    return this.decodeAudioBuffer(arrayBuffer);
  }

  private async decodeUrlAudio(audioSrc: string): Promise<AudioBuffer> {
    const response = await fetch(
      new URL(audioSrc, document.baseURI).toString(),
    );
    const arrayBuffer = await response.arrayBuffer();
    return this.decodeAudioBuffer(arrayBuffer);
  }

  private async decodeAudioBuffer(
    arrayBuffer: ArrayBuffer,
  ): Promise<AudioBuffer> {
    this.audioContext ??= new AudioContext();

    return this.audioContext.decodeAudioData(arrayBuffer.slice(0));
  }

  private calculateSimilarityPercent(
    referenceBuffer: AudioBuffer,
    recordedBuffer: AudioBuffer,
  ): number {
    const referenceSamples = this.trimSilence(
      this.mixToMono(referenceBuffer),
      0.015,
    );
    const recordedSamples = this.trimSilence(
      this.mixToMono(recordedBuffer),
      0.02,
    );

    if (referenceSamples.length < 256 || recordedSamples.length < 256) {
      return 0;
    }

    const referenceEnvelope = this.normalizeEnvelope(
      this.buildEnvelope(referenceSamples, 1024),
    );
    const recordedEnvelope = this.normalizeEnvelope(
      this.buildEnvelope(recordedSamples, 1024),
    );

    const targetLength = 220;
    const referenceResampled = this.resampleEnvelope(
      referenceEnvelope,
      targetLength,
    );
    const recordedResampled = this.resampleEnvelope(
      recordedEnvelope,
      targetLength,
    );

    const bestDistance = this.getBestAlignedDistance(
      referenceResampled,
      recordedResampled,
      24,
    );

    return Math.max(0, Math.min(100, (1 - bestDistance) * 100));
  }

  private mixToMono(buffer: AudioBuffer): Float32Array {
    const channelCount = buffer.numberOfChannels;
    const length = buffer.length;
    const mono = new Float32Array(length);

    for (let channel = 0; channel < channelCount; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        mono[i] += data[i];
      }
    }

    for (let i = 0; i < length; i++) {
      mono[i] /= channelCount;
    }

    return mono;
  }

  private trimSilence(samples: Float32Array, threshold: number): Float32Array {
    let start = 0;
    let end = samples.length - 1;

    while (start < samples.length && Math.abs(samples[start]) < threshold) {
      start++;
    }

    while (end > start && Math.abs(samples[end]) < threshold) {
      end--;
    }

    return samples.slice(start, end + 1);
  }

  private buildEnvelope(
    samples: Float32Array,
    windowSize: number,
  ): Float32Array {
    const frameCount = Math.max(1, Math.ceil(samples.length / windowSize));
    const envelope = new Float32Array(frameCount);

    for (let frame = 0; frame < frameCount; frame++) {
      const start = frame * windowSize;
      const end = Math.min(samples.length, start + windowSize);
      let sum = 0;

      for (let i = start; i < end; i++) {
        sum += Math.abs(samples[i]);
      }

      envelope[frame] = sum / Math.max(1, end - start);
    }

    return envelope;
  }

  private normalizeEnvelope(envelope: Float32Array): Float32Array {
    let maxValue = 0;
    for (const value of envelope) {
      if (value > maxValue) {
        maxValue = value;
      }
    }

    if (maxValue <= 0) {
      return envelope;
    }

    const normalized = new Float32Array(envelope.length);
    for (let i = 0; i < envelope.length; i++) {
      normalized[i] = envelope[i] / maxValue;
    }
    return normalized;
  }

  private resampleEnvelope(
    envelope: Float32Array,
    targetLength: number,
  ): Float32Array {
    if (envelope.length === targetLength) {
      return envelope;
    }

    const output = new Float32Array(targetLength);
    const lastIndex = Math.max(0, envelope.length - 1);

    for (let i = 0; i < targetLength; i++) {
      const position = (i / Math.max(1, targetLength - 1)) * lastIndex;
      const left = Math.floor(position);
      const right = Math.min(lastIndex, left + 1);
      const ratio = position - left;
      output[i] = envelope[left] * (1 - ratio) + envelope[right] * ratio;
    }

    return output;
  }

  private getBestAlignedDistance(
    referenceEnvelope: Float32Array,
    recordedEnvelope: Float32Array,
    maxShift: number,
  ): number {
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let shift = -maxShift; shift <= maxShift; shift++) {
      let sum = 0;
      let count = 0;

      for (let i = 0; i < referenceEnvelope.length; i++) {
        const j = i + shift;
        if (j < 0 || j >= recordedEnvelope.length) {
          continue;
        }

        sum += Math.abs(referenceEnvelope[i] - recordedEnvelope[j]);
        count++;
      }

      if (count > 0) {
        const distance = sum / count;
        if (distance < bestDistance) {
          bestDistance = distance;
        }
      }
    }

    return Number.isFinite(bestDistance) ? bestDistance : 1;
  }

  private stopReferenceAudio(): void {
    const audio = this.referenceAudio?.nativeElement;
    if (!audio) {
      return;
    }

    audio.pause();
    audio.currentTime = 0;
  }

  private releaseMicrophone(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = undefined;
    }

    this.mediaRecorder = undefined;
    this.isRecording = false;
  }

  private resetComparisonState(): void {
    this.comparisonDone = false;
    this.canProceed = false;
    this.isRecording = false;
    this.isAnalyzing = false;
    this.comparisonMessage = "";
    this.similarityPercent = null;
    this.recordedChunks = [];
    this.revokeRecordedAudioUrl();
    this.stopSpeechFeedback();
  }

  private speakFeedback(message: string): void {
    if (!("speechSynthesis" in globalThis) || !message) {
      return;
    }

    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = "pt-BR";
    utterance.rate = 0.98;
    utterance.pitch = 1;

    this.stopSpeechFeedback();
    globalThis.speechSynthesis.speak(utterance);
  }

  private stopSpeechFeedback(): void {
    if (!("speechSynthesis" in globalThis)) {
      return;
    }

    if (
      globalThis.speechSynthesis.speaking ||
      globalThis.speechSynthesis.pending
    ) {
      globalThis.speechSynthesis.cancel();
    }
  }

  private revokeRecordedAudioUrl(): void {
    if (!this.recordedAudioUrl) {
      return;
    }

    URL.revokeObjectURL(this.recordedAudioUrl);
    this.recordedAudioUrl = "";
  }

  ngOnDestroy(): void {
    this.releaseMicrophone();
    this.revokeRecordedAudioUrl();
    this.stopSpeechFeedback();
    void this.audioContext?.close();
  }
}

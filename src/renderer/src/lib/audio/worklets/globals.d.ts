// Globals of AudioWorkletGlobalScope, which TypeScript's DOM lib does not declare.

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;

/** Frame index of the first sample in the current render quantum. */
declare const currentFrame: number;
declare const sampleRate: number;

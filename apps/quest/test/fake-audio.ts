/** A minimal recording stand-in for the Web Audio API (tests only). */
export class FakeParam {
  value = 0;
  setValueAtTime(v: number) {
    this.value = v;
    return this;
  }
  setTargetAtTime(v: number) {
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime() {
    return this;
  }
}

export class FakeNode {
  readonly connections: FakeNode[] = [];
  constructor(
    readonly kind: string,
    readonly ctx: FakeAudioContext,
  ) {
    ctx.nodes.push(this);
  }
  connect<T>(target: T): T {
    this.connections.push(target as unknown as FakeNode);
    return target;
  }
  disconnect() {}
}

class FakeSource extends FakeNode {
  type = 'sine';
  buffer: unknown = null;
  frequency = new FakeParam();
  detune = new FakeParam();
  stops: number[] = [];
  start() {}
  stop(t = 0) {
    this.stops.push(t);
  }
}

export class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  readonly nodes: FakeNode[] = [];
  state: 'running' | 'suspended' = 'running';
  currentTime = 0;
  sampleRate = 8000;
  readonly destination = new FakeNode('destination', this);
  readonly listener = {
    positionX: new FakeParam(),
    positionY: new FakeParam(),
    positionZ: new FakeParam(),
    forwardX: new FakeParam(),
    forwardY: new FakeParam(),
    forwardZ: new FakeParam(),
    upX: new FakeParam(),
    upY: new FakeParam(),
    upZ: new FakeParam(),
  };
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.state = 'suspended';
    return Promise.resolve();
  }
  createGain() {
    return Object.assign(new FakeNode('gain', this), { gain: new FakeParam() });
  }
  createOscillator() {
    return new FakeSource('oscillator', this);
  }
  createBufferSource() {
    return new FakeSource('buffer', this);
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode('filter', this), { type: 'lowpass', frequency: new FakeParam(), Q: new FakeParam() });
  }
  createDynamicsCompressor() {
    return Object.assign(new FakeNode('compressor', this), { threshold: new FakeParam(), ratio: new FakeParam() });
  }
  createPanner() {
    return Object.assign(new FakeNode('panner', this), {
      panningModel: '',
      distanceModel: '',
      refDistance: 1,
      rolloffFactor: 1,
      positionX: new FakeParam(),
      positionY: new FakeParam(),
      positionZ: new FakeParam(),
    });
  }
  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
}

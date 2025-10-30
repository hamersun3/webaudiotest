import { useCallback, useEffect, useState } from "react";
import styles from "./App.module.css";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function assert(condition: any, message?: string): asserts condition {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

class AudioDeviceManager {
  currentInputDevices: string[];
  currentOutputDevices: string[];
  outputNodes: AudioNode[];
  analyser?: AnalyserNode;
  audioBuffer?: AudioBufferSourceNode;
  decodedAudioData?: AudioBuffer;
  delayNode?: DelayNode;
  delayEnabled: boolean = false;
  echoCancellationEnabled: boolean = false;
  audioElement: HTMLAudioElement;
  ctx?: AudioContext;
  analyserData?: Uint8Array;
  currentSources: AudioNode[];
  inputStreams: MediaStream[];
  nextIndex: number;

  constructor() {
    this.audioElement = document.createElement("audio");
    this.audioElement.src = "./guitar.mp3";
    this.audioElement.loop = true;
    this.audioElement.volume = 0.2;
    document.body.append(this.audioElement);

    this.currentInputDevices = new Array<string>();
    this.currentOutputDevices = new Array<string>();
    this.outputNodes = new Array<AudioNode>();
    this.currentSources = new Array<AudioNode>();
    this.inputStreams = new Array<MediaStream>();
    this.nextIndex = 0;
    this.createContext();
  }

  createContext() {
    console.debug("[[[[[[createContext...]]]]]")
    if (this.ctx) {
      this.ctx.close();
    }
    if (this.audioBuffer) {
      this.audioBuffer.stop();
    }

    this.ctx = new window.AudioContext();

    this.outputNodes[0] = this.ctx.createGain();
    this.outputNodes[0].connect(this.ctx.destination);
    this.outputNodes[1] = this.ctx.createGain();
    this.outputNodes[1].connect(this.ctx.destination);

    this.analyser = this.ctx.createAnalyser();
    this.analyser.connect(this.outputNodes[0]);
    this.analyser.fftSize = 32;
    this.analyserData = new Uint8Array(this.analyser.frequencyBinCount);

    delete this.audioBuffer;
    delete this.decodedAudioData;

    if (this.currentInputDevices[0]) {
      this.setInputDevice(this.currentInputDevices[0]);
    }
    if (this.currentInputDevices[1]) {
      this.setInputDevice(this.currentInputDevices[1]);
    }
    
    if (this.currentOutputDevices[0]) {
      this.setOutputDevice(this.currentOutputDevices[0]);
    }
    if (this.currentOutputDevices[1]) {
      this.setOutputDevice(this.currentOutputDevices[1]);
    }
  }

  resumeContext() {
    if (this.ctx?.state === "suspended") {
      this.ctx.resume();
    }
  }

  async getDevices(kind: MediaDeviceKind) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === kind,
    );
    devices.sort((a, b) =>
      a.label.toLowerCase() > b.label.toLowerCase() ? 1 : -1,
    );

    // We need to call getUserMedia media in order to enumerateDevices with labels.
    // Then we have to stop the audio track, since Firefox thinks we're still using
    // the stream if we try to switch devices later.
    for (const track of stream.getAudioTracks()) {
      track.stop();
    }

    return devices;
  }

  async setInputDevice(deviceId: string) {
    assert(this.ctx, "no audio context");
    assert(this.analyser, "no analyser");
    if ((this.nextIndex + 1) % 2 == 0) {
      this.nextIndex = 0;
    } else {
      this.nextIndex++;
    }

    this.currentInputDevices[this.nextIndex] = deviceId;

    console.debug("setInputDevice with id " + deviceId);
    if (this.currentSources[this.nextIndex]) {
      console.warn("\t currentSource is not null, disconnect currentSource");
      this.currentSources[this.nextIndex].disconnect();
    }

    console.debug("setInputDevice " + deviceId + "....");
    if (this.inputStreams[this.nextIndex]) {
      for (const track of this.getInputTracks()) {
        track.stop();
      }
    }

    console.debug("setInputDevice: call navigator.mediaDevices.getUserMedia to create inputStream");
    this.inputStreams[this.nextIndex] = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId, echoCancellation: this.echoCancellationEnabled },
    });

    console.debug("setInputDevice: call createMediaStreamSource..");
    this.currentSources[this.nextIndex] = this.ctx.createMediaStreamSource(this.inputStreams[this.nextIndex]);
    this.delayNode = new DelayNode(this.ctx, { delayTime: 1 });

    if (this.delayEnabled) {
      this.currentSources[this.nextIndex].connect(this.delayNode);
      this.delayNode.connect(this.analyser);
    } else {
      this.currentSources[this.nextIndex].connect(this.analyser);
    }
    console.debug("inputStream: " + this.inputStreams[this.nextIndex]);
  }

  async setOutputDevice(deviceId: string) {
    assert(this.ctx, "no audio context");
    assert(this.outputNodes[this.nextIndex], "no output node");
    console.debug("setOutputDevice with id: " + deviceId);

    this.currentOutputDevices[this.nextIndex] = deviceId;

    this.outputNodes[this.nextIndex].disconnect();
    console.debug("setOutputDevice: call createMediaStreamDestination");
    const dest = this.ctx.createMediaStreamDestination();
    this.outputNodes[this.nextIndex].connect(dest);
    console.debug("\t dest: " + dest);

    const audioOutput = new Audio();
    audioOutput.srcObject = dest.stream;
    audioOutput.setSinkId(deviceId);
    audioOutput.play();

    this.audioElement.setSinkId(deviceId);
  }

  getAnalyserLevel() {
    assert(this.analyser);
    assert(this.analyserData);

//    this.analyser.getByteFrequencyData(this.analyserData);
    let sum = 0;
    for (let i = 0; i < this.analyserData.length; i++) {
      sum += this.analyserData[i] / 255;
    }
    sum = sum / this.analyserData.length;
    return sum;
  }

  getInputTracks() {
    assert(this.inputStreams[this.nextIndex]);
    return this.inputStreams[this.nextIndex].getAudioTracks();
  }

  getConstraints() {
    return navigator.mediaDevices.getSupportedConstraints();
  }

  toggleAudioElement() {
    if (this.audioElement.paused) {
      this.audioElement.play();
    } else {
      this.audioElement.pause();
    }
  }

  async toggleAudioBuffer() {
    if (this.audioBuffer) {
      this.audioBuffer.stop();
      delete this.audioBuffer;

      return true;
    } else {
      assert(this.ctx);
      assert(this.outputNodes[this.nextIndex]);

      this.audioBuffer = this.ctx.createBufferSource();

      if (!this.decodedAudioData) {
        const audioData = await fetch("./beat.mp3").then((resp) =>
          resp.arrayBuffer(),
        );
        this.decodedAudioData = await this.ctx.decodeAudioData(audioData);
      }

      this.audioBuffer.buffer = this.decodedAudioData;

      this.audioBuffer.connect(this.outputNodes[this.nextIndex]);
      this.audioBuffer.loop = true;
      this.audioBuffer.start();

      return false;
    }
  }

  toggleDelay() {
    assert(this.analyser);

    if (this.delayEnabled) {
      if (this.currentSources[this.nextIndex] && this.delayNode) {
        this.currentSources[this.nextIndex].disconnect();
        this.delayNode.disconnect();
        this.currentSources[this.nextIndex].connect(this.analyser);
      }
      this.delayEnabled = false;
    } else {
      if (this.currentSources[this.nextIndex] && this.delayNode) {
        this.currentSources[this.nextIndex].disconnect();
        this.currentSources[this.nextIndex].connect(this.delayNode);
        this.delayNode.connect(this.analyser);
      }
      this.delayEnabled = true;
    }
    return this.delayEnabled;
  }

  toggleEchoCancellation() {
    this.echoCancellationEnabled = !this.echoCancellationEnabled;
    if (this.currentInputDevices[this.nextIndex]) {
      this.setInputDevice(this.currentInputDevices[this.nextIndex]);
    }
    return this.echoCancellationEnabled;
  }
}

function AudioMeter({
  audioDeviceManager,
}: {
  audioDeviceManager: AudioDeviceManager;
}) {
  const [value, setValue] = useState<number>(0);

  const updateValue = useCallback(
    function () {
      const value = audioDeviceManager.getAnalyserLevel();
      setValue(value);
      requestAnimationFrame(updateValue);
    },
    [audioDeviceManager],
  );

  useEffect(() => {
    requestAnimationFrame(updateValue);
  }, [updateValue]);

  return (
    <div className={styles.meter}>
      <div className={styles.bar} style={{ width: `${value * 100}%` }} />
    </div>
  );
}

function stringToColor(str: string) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash + str.charCodeAt(i) * 20) % 255;
  }
  const prefersDarkMode = window.matchMedia("(prefers-color-scheme: dark)");
  return `hsl(${(hash / 255) * 360}, 100%, ${prefersDarkMode.matches ? 15 : 80}%)`;
}

function Devices({
  title,
  devices,
  setDevice,
}: {
  setDevice: (deviceId: string) => void;
  title: string;
  devices: MediaDeviceInfo[];
}) {
  return (
    <div>
      <h2>{title}:</h2>
      {devices.length === 0 ? "- no devices -" : null}
      {devices.map((device) => (
        <div key={device.deviceId} className={styles.device}>
          <button
            className={styles.useDevice}
            onClick={() => setDevice(device.deviceId)}
          >
            use
          </button>
          <div className={styles.deviceInfo}>
            <div>
              <label>label:</label>
              <span>{device.label}</span>
            </div>

            <div>
              <label>kind:</label>
              <span style={{ backgroundColor: stringToColor(device.kind) }}>
                {device.kind}
              </span>
            </div>

            <div>
              <label>deviceId:</label>
              <span style={{ backgroundColor: stringToColor(device.deviceId) }}>
                {device.deviceId}
              </span>
            </div>

            <div>
              <label>groupId:</label>
              <span style={{ backgroundColor: stringToColor(device.groupId) }}>
                {device.groupId}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

type DevicesStateProp = "inputDevices" | "outputDevices";

const audioDeviceManager: AudioDeviceManager = new AudioDeviceManager();

function App() {
  const [status, setStatus] = useState<string>("");
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [inputTracks, setInputTracks] = useState<MediaStreamTrack[]>([]);
  const [constraints, setConstraints] =
    useState<MediaTrackSupportedConstraints>({});
  const [audioElementPaused, setAudioElementPaused] = useState<boolean>(true);
  const [audioBufferPaused, setAudioBufferPaused] = useState<boolean>(true);
  const [delayEnabled, setDelayEnabled] = useState<boolean>(false);
  const [echoCancellationEnabled, setEchoCancellationEnabled] =
    useState<boolean>(false);

  useEffect(() => {
    document.addEventListener("click", () =>
      audioDeviceManager.resumeContext(),
    );
  }, []);

  function getConstraints() {
    setConstraints(audioDeviceManager.getConstraints());
  }

  async function getDevices(
    kind: MediaDeviceKind,
    stateProp: DevicesStateProp,
  ) {
    try {
      setStatus("getting devices");

      const devices = await audioDeviceManager.getDevices(kind);

      if (stateProp === "inputDevices") {
        setInputDevices(devices);
      } else if (stateProp === "outputDevices") {
        setOutputDevices(devices);
      } else {
        throw new Error(`unknown stateProp ${stateProp}`);
      }
      setStatus(devices.length ? "got devices ..." : "no devices found ...");
    } catch (e) {
      setStatus(`error getting devices ${e}`);
      console.error(e);
    }
  }

  async function setInputDevice(deviceId: string) {
    setStatus("getting device");
    setInputTracks([]);
    try {
      await audioDeviceManager.setInputDevice(deviceId);
      setStatus("got device");
      setInputTracks(await audioDeviceManager.getInputTracks());
    } catch (e) {
      setStatus(`error getting device ${e}`);
      console.error(e);
    }
  }

  async function setOutputDevice(deviceId: string) {
    setStatus("setting output device");
    audioDeviceManager.setOutputDevice(deviceId);
    setStatus("set output device");
  }

  function toggleAudioElement() {
    audioDeviceManager.toggleAudioElement();
    setAudioElementPaused((audioElementPaused) => !audioElementPaused);
  }

  async function toggleAudioBuffer() {
    const audioBufferPaused = await audioDeviceManager.toggleAudioBuffer();
    setAudioBufferPaused(audioBufferPaused);
  }

  async function toggleDelay() {
    const delayEnabled = await audioDeviceManager.toggleDelay();
    setDelayEnabled(delayEnabled);
  }

  async function toggleEchoCancellation() {
    const echoCancellationEnabled =
      await audioDeviceManager.toggleEchoCancellation();
    setEchoCancellationEnabled(echoCancellationEnabled);
  }

  function recreateContext() {
    setStatus("recreating context");
    audioDeviceManager.createContext();
    setAudioBufferPaused(true);
    setStatus("context recreated");
  }

  return (
    <div className={styles.app}>
      <h1>mic test</h1>

      <p>
        A basic set of web audio tests including a local microphone echo test,
        audio playback and output selection (where supported). <br />
        Source code on{" "}
        <a href="https://github.com/brianpeiris/mic-test" target="blank">
          github
        </a>
        .
      </p>

      <div>status: {status || "-"}</div>

      <AudioMeter audioDeviceManager={audioDeviceManager} />

      <button onClick={() => getDevices("audioinput", "inputDevices")}>
        get input devices
      </button>

      <button onClick={() => getDevices("audiooutput", "outputDevices")}>
        get output devices
      </button>

      <br />

      <button onClick={() => toggleAudioElement()}>
        {audioElementPaused ? "play" : "pause"} audio element
      </button>

      <button onClick={() => toggleAudioBuffer()}>
        {audioBufferPaused ? "play" : "pause"} audio buffer
      </button>

      <br />

      <button onClick={() => recreateContext()}>recreate context</button>

      <button onClick={() => getConstraints()}>get constraints</button>

      <br />

      <button onClick={() => toggleDelay()}>
        {delayEnabled ? "remove" : "add"} delay
      </button>

      <button
        onClick={() => toggleEchoCancellation()}
        className={styles.echoCancellationButton}
      >
        {echoCancellationEnabled ? "disable" : "enable"} echo cancellation
      </button>

      <h2>input tracks:</h2>
      <div>{inputTracks.length === 0 ? "- no input tracks -" : null}</div>
      {inputTracks.map((track, i) => (
        <div key={i} className={styles.track}>
          <div>
            <label>label:</label>
            <span>{track.label}</span>
          </div>

          <div>
            <label>enabled:</label>
            <span>{String(track.enabled)}</span>
          </div>

          <div>
            <label>muted:</label>
            <span>{String(track.muted)}</span>
          </div>

          <div>
            <label>readyState:</label>
            <span>{track.readyState}</span>
          </div>
        </div>
      ))}

      <Devices
        title="input devices"
        devices={inputDevices}
        setDevice={(deviceId) => setInputDevice(deviceId)}
      />

      <Devices
        title="output devices"
        devices={outputDevices}
        setDevice={(deviceId) => setOutputDevice(deviceId)}
      />

      <h2>constraints:</h2>
      <div>
        {Object.entries(constraints).length === 0 ? "- no constraints -" : null}
      </div>
      {Object.entries(constraints).map(([name], i) => (
        <div key={i}>
          <div key={i}>{name}</div>
        </div>
      ))}
    </div>
  );
}

export default App;

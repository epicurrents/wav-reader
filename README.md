WAV file reader for Epicurrents
===============================

Reads a RIFF/WAVE file as a biosignal recording. The package is a format plugin for [`@epicurrents/core`](https://github.com/epicurrents/core): it recognises the file, reports what the header declares, and serves the samples to whichever study module the consumer registers it under. It carries no UI and no modality of its own — the builder's EMG edition registers it as that modality's WAV importer.

Install
-------

```bash
npm install @epicurrents/wav-reader
```

Use
---

```ts
import { WavImporter, WavWorkerSubstitute } from '@epicurrents/wav-reader'

const importer = new WavImporter()
// Without SharedArrayBuffer there is no worker to read through, so the substitute runs the same
// commission handlers on the main thread.
importer.setWorkerOverride('emg', () => useSAB ? wavWorker() : new WavWorkerSubstitute())
app.registerStudyImporter('emg/wav-file', 'Open WAV file', 'file', new EmgStudyLoader('EmgWavLoader', importer))
```

The importer resolves its own worker: the build inlines it into `dist/`, so nothing downstream has a bundle to copy. A consumer whose content security policy forbids `worker-src blob:` serves `umd/wav.worker.js` instead and registers a URL-based factory, which takes precedence over the inlined default.

What it reads
-------------

| Property | Support |
|---|---|
| Container | RIFF/WAVE, little-endian |
| Sample format | 16-bit signed PCM |
| Channels | Any number, interleaved frame by frame |
| Chunks | `fmt `, `data` and `fact`; any other chunk between them is skipped |
| Sources | A local `File` or an HTTP URL that answers range requests |

**Only 16-bit PCM is read**, and the limit belongs to the reader rather than to the parser: the signal cache's element type and the data-unit arithmetic are both fixed at two bytes per sample. A file of another width is refused when the study is opened, because reading an 8-bit file as 16-bit pairs each sample with its neighbour and every value that comes out is plausible.

Sample counts and durations are **per channel** throughout, as the `fact` chunk states them and as a biosignal header expects them. The data chunk holds one sample per channel per frame, so a count taken from its byte length alone would scale with the channel count.

A WAV file **carries no calibration**, so by default each stored integer is read as one microvolt. A host that knows its acquisition device gives the importer the physical value of full scale instead:

```ts
const importer = new WavImporter({ calibration: { physicalMax: 5, physicalUnit: 'mV' } })
```

`physicalMax` is what a stored -32768 reads as, negated; `physicalUnit` defaults to `uV` and names the unit of every channel. Samples leave the reader in the base unit as `getSignalScale` defines it (volts for a voltage), so `-32768` above reads as -5 mV. The importer records the calibration in the study metadata and posts it to each worker it hands over as a `set-calibration` message, ahead of `setup-worker`, so the study module carrying the worker needs no part in it. `setCalibration` changes it for the files imported after; a recording already open keeps the scale it was opened with. An invalid calibration (a full scale that is not a finite number above zero, or an empty unit) is refused, and the importer then imports nothing until a valid one is set, because opening the file at the default scale gives values that look right and are not.

A WAV recording is **one continuous span of samples**, so recording time and data time are the same measurement. An interruption table is therefore refused rather than applied — honouring one would displace every later read by the gaps it declares and return samples that still look entirely plausible. An empty table is accepted, since that is also how a caller marks the timing of a recording fully known.

Structure
---------

| File | Responsibility |
|---|---|
| [src/wav/WavImporter.ts](src/wav/WavImporter.ts) | Recognises the file, reads its header into the study, hands over the worker |
| [src/wav/WavReader.ts](src/wav/WavReader.ts) | Opens the study and derives the data-unit shape the cache is built from |
| [src/wav/WavDecoder.ts](src/wav/WavDecoder.ts) | Parses the chunk structure and deinterleaves the PCM samples |
| [src/wav/WavWorkerSubstitute.ts](src/wav/WavWorkerSubstitute.ts) | Runs the worker's own commission handlers on the main thread |
| [src/workers/wav.worker.ts](src/workers/wav.worker.ts) | The worker thread, `SignalReaderWorker` plus `set-calibration` and `setup-worker` |
| [src/util.ts](src/util.ts) | Converts a parsed WAV header into a biosignal header; the default calibration and its validation |

Develop
-------

```bash
npm run build       # umd/ worker bundle, then dist/ and its declarations
npm run lint        # ESLint 9, the family rule set
npm run typecheck   # tsc over src/
npm test            # type-check the suite against real core, then run it with coverage
```

The suite builds WAV files byte by byte and drives the real decoder, reader, importer, worker and substitute over them; nothing stands in for `@epicurrents/core`. Known gaps are in [ROADMAP.md](ROADMAP.md).

License
-------

Apache-2.0. See [LICENSE](LICENSE).

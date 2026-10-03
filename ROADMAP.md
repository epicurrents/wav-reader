# WAV reader roadmap

Open and deferred work, and the findings of the audit pass that are recorded rather than fixed.

## Closed by the audit pass

The package is registered by the builder's EMG edition, so unlike the unwired modules of this family every one of these was reachable from a user opening a WAV file.

- **Every signal read came back as NaN.** `GenericSignalReader` slices the data region at a frame boundary and hands the slice to `decodeData` with an offset of zero; this decoder re-applied the header's own `dataOffset` to it and then read the whole recording's sample count out of it. So each chunk was shifted 44 bytes — 22 samples — past where it begins and overrun for the rest, and the overrun arrives as NaN rather than as an error. Both halves are silent: the samples returned are real samples from the wrong position. The count now comes from whichever bound runs out first, the buffer the caller sliced or the data chunk the header declares.
- **A multi-channel recording claimed a length its data chunk did not have.** With no `fact` chunk the sample count was derived as `dataSize/(bitsPerSample/8)`, which counts the samples of every channel at once. A stereo file therefore reported twice its real duration and twice its per-channel sample count, and the reader served reads past the end of the data for the half that is not there. Counts and durations are per channel throughout, as the `fact` chunk states them and as a biosignal header expects them.
- **Any chunk between `fmt ` and `data` refused the file.** Only a `fact` chunk was skipped; a `LIST` chunk of authoring metadata — routine in files from recording software — made the parse abort with *"Data description header is 'LIST'"*. The chunk list is now walked, odd-sized payloads' pad bytes included, and anything the reader has no use for is skipped.
- **Sample width was assumed rather than checked.** `decodeData` unpacked at a fixed 16 bits however the header was read, so an 8-bit file decoded to half as many samples, each one a pair of the real ones, with every value plausible. The header's own `bitsPerSample` expectation existed but refused nothing. The width is now checked where the assumption lives: `decodeData` refuses one it cannot read, and `setupStudy` refuses the study, so the reason reaches the caller rather than the samples.
- **Each channel re-read the whole data chunk.** The slice and the unpack were inside the channel loop, although the channels are interleaved in the same bytes — eight copies and eight unpacks of one chunk on an eight-channel file. Unpacked once now.
- **`fileSize` was eight bytes short of the file size.** The field holds the RIFF payload count, which excludes the identifier and the count itself, and the importer reported it to the application under the name `fileSize`. The name is the contract, so the preamble is added back.
- **The worker substitute answered five of the twelve commissions a signal reader answers**, and refused the other seven with *"Action X is not implemented"* — `shutdown` among them. That is not a degraded fallback: `GenericService.shutdown` and `unload` both await a commission before tearing anything down and a failed commission rejects, so the missing handler left a study impossible to close, on exactly the path taken when the environment has no SharedArrayBuffer. It now extends `SignalReaderWorkerSubstitute` and runs the worker's own handlers, as `csv-reader`, `dicom-reader`, `natus-reader` and `nic-reader` do.
- **Adopting the shared vocabulary made the package start answering `set-interruptions`**, which it has to refuse: a WAV recording is one continuous span of samples, so a table of gaps describes a timeline this reader does not serve and honouring one would displace every later read. Stated in both the worker and the substitute, since the two run the same handlers and the refusal is a property of the format rather than of the thread.
- **The worker registered a handler it already had.** Found by mutation rather than by reading: unregistering `set-interruptions` in the worker changed no behaviour and failed no test, because the base class builds its action map in a field initializer where `this.setInterruptions` already resolves through the prototype chain to the override. Only `setup-worker` needs registering, since no base map carries it. The substitute is the opposite case and does need both, because the handlers running there belong to a separate instance whose map resolves the base class's method — which is why this package's worker and its substitute now register different sets, where `natus-reader`'s and `nic-reader`'s register the same one in both.
- **The cache-process reset spliced the array while indexing forward over it**, so every second process kept its `continue` flag and kept reading against the cache the new study replaced. It was also unreachable as written — `setupStudy` refuses outright once a cache exists, which is the only state in which a cache process exists — but it is a public entry point and the guard it leans on is in another package, so the loop is now correct rather than deleted.
- **The reader held a second reference to the settings.** It kept the application's settings in a private field and passed nothing to the base class, which then fell back to core's own module singleton; the data-unit arithmetic read one object and the base class's cache-size arithmetic the other. The application mutates the object in place when it relays an update, so the two agreed in practice — but only because nothing had replaced either.
- **The importer logged under the reader's scope.** Its `SCOPE` was `WavReader`, which is also the scope the reader logs under and the name it passes to its own base class, so every importer message claimed to come from the reader.
- **`readHeader` dropped the promise of the call it depends on.** `_readHeaderInfo` was declared asynchronous, awaited nothing, and was called without `await`; it happened to run to completion before the return because it has no suspension point. It is synchronous now, which is what it was.
- **The worker dropped the promise of its own dispatch.** `onmessage` called `handleMessage` without awaiting it, so a throw inside a handler surfaced as an unhandled rejection rather than reaching the handler that answers the commission.
- **A substitute built without an application logged an error and then threw anyway.** The constructor reported the missing runtime and dereferenced it on the next line, so the message promised handling that did not exist. The substitute requires the runtime, and now says so by failing the same way its four siblings do.
- **The lint configuration was the ESLint 8 format** that ESLint 9 will not read, over a rule set of two rules, and a stale ESLint 8 in the package's own `node_modules` is what made it appear to work. The package carries the family's flat config now and reports nothing against it.
- **The declared core range was `^1.0.0`** while the workspace carries 2.0.0 — the last package in the family still on it. See below for where the range has to go at release.
- **The package had no tests.** The one file under `tests/` imported a reader from a path that has not existed since the sources were arranged into `src/wav/`, and constructed it with a string where it takes the application settings. It also matched none of the patterns the vitest config includes, so nothing ran it and nothing reported that it could not run — while the `test` script remained the one in the family that fails the workspace sweep.
- **A `.env.example`** declaring two variables no file in the repository reads.

## The declared core range has to move at release

The package now extends `SignalReaderWorkerSubstitute`, which the published core 2.0.0 does not export — confirmed by unpacking its tarball. `^2.0.0` therefore states a version the package does not work against, and the range has to become `^2.1.0` once core publishes that class and the three `BaseWorker` members behind it. The same is true of `csv-reader`, `dicom-reader`, `natus-reader` and `nic-reader`, and the builder's roadmap tracks the set; `^2.0.0` is what the package is verified against in the workspace, and the bump belongs to the release rather than to this pass.

The worker's `setup-worker` still validates through `validateCommissionProps` rather than the base class's `_validate`, matching the four siblings. Converting it is free once the range moves, and buys the reply following a redirected transport.

## Open

### Only 16-bit PCM is read

🟡 **Priority: yellow** — a file of another width is refused with a clear reason, so nothing is served wrongly; it simply cannot be opened.

The limit is the reader's, not the parser's: `GenericSignalReader` is constructed with `Int16Array` and `_dataUnitSize` is computed at two bytes per sample. Supporting 8-, 24- or 32-bit PCM means making the element type and that arithmetic follow the header, and widening `decodeData` to unpack at the declared width. Nothing asks for it yet, and until something does the refusal is the honest answer.

### The whole header has to be inside the first kilobyte

🟡 **Priority: yellow** — a file whose chunk list runs past that is refused rather than misread.

`setupStudy` and the importer both read 1024 bytes and expect the data chunk to be found inside them. A file carrying a large `LIST` or `INFO` block can push the samples past that, and the only way to know is to have walked the chunks. The fix is to re-read with a larger window when the walk runs out of buffer rather than refusing, which needs the importer's and the reader's two source paths to share one chunk-walking step.

### A chunk after the samples can still be read as samples at the very end of a recording

🟡 **Priority: yellow** — bounded by one data unit, at the end of the recording, and only for a file that carries a chunk after its `data` chunk.

`decodeData` bounds the samples by whichever runs out first, the buffer or the declared data size. That is exact for a whole-file decode, and for a part of the file it is the buffer that bounds it — except for the last part, because `GenericSignalReader` sizes its cache in whole data units and `_dataUnitCount` is `ceil(duration)`. A recording of 10.5 seconds is eleven units, so the final slice reaches half a second past the samples, and in a file with a trailing chunk those bytes are that chunk's.

Capping it properly needs the part's offset within the data region, which the decoder is not given: the only positional argument it receives is a record index, from which the offset can be derived only by assuming the one-second data unit this reader happens to use. Inferring it risks truncating real samples in the middle of a recording to avoid reading metadata at the end of one, which is the worse trade. The fix is for core to pass the offset, which is also what would let the parameter be named for what it is.

### The blob URL the importer creates is never revoked

🟡 **Priority: yellow** — the same gap the other readers of the family have, and the ownership question is the same one.

`importFile` calls `URL.createObjectURL(file)` when the configuration names no URL, and nothing revokes it. The study outlives the importer, so the importer cannot be the one to revoke it; whoever disposes of the study context is. Recorded in the builder's roadmap as a family-wide item rather than solved here.

### Two paths the suite does not reach

🟢 **Priority: green** — both are stated rather than chased.

`bufferToBiosignalAudio` wraps the file in core's `BiosignalAudio`, which decodes through an `AudioContext` the test environment does not provide; its refusal path is covered and its success path is not. Nothing in the package calls the method — it is there for a playback consumer that does not exist yet, and it is the one piece of public surface with no caller.

The `catch` in `decodeHeader` is a backstop with no input that reaches it: the unpacker answers a read past the end of the buffer with NaN rather than an error, so a truncated file is refused by the chunk walk instead. It stays as the guard for an input that is not a buffer of bytes at all.

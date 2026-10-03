/**
 * Epicurrents WAV worker substitute. Drives {@link WavReader} on the main thread, for environments
 * without SharedArrayBuffer or cross-origin isolation.
 *
 * The commission handlers are the worker's own, run on this thread by
 * {@link SignalReaderWorkerSubstitute}; what is added here is the study's opening and the one
 * refusal the format calls for. Answering a hand-written subset of the vocabulary instead looks like
 * a degraded but working fallback and is not one: `GenericService.shutdown` and `unload` both await
 * a commission before tearing anything down, and an unrecognised action is answered with a failure,
 * so a missing handler does not slow a study down — it leaves it impossible to close.
 * @package    epicurrents/wav-reader
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { SignalReaderWorkerSubstitute } from '@epicurrents/core'
import type { WorkerMessage, WorkerSubstitute } from '@epicurrents/core/types'
import WavReader from '#wav/WavReader'

export default class WavWorkerSubstitute extends SignalReaderWorkerSubstitute<WavReader>
    implements WorkerSubstitute {

    constructor () {
        super(new WavReader(window.__EPICURRENTS__.RUNTIME!.SETTINGS))
        this._reader.setUpdateCallback((update: { [prop: string]: unknown }) => {
            if (update.action === 'cache-signals') {
                this.returnMessage(update as WorkerMessage['data'])
            }
        })
        // The substitute binds an added handler to itself before registering it, so an entry passed
        // unbound here still runs with this substitute as its `this`.
        // eslint-disable-next-line @typescript-eslint/unbound-method
        this.extendActionMap([['set-interruptions', this.setInterruptions], ['setup-worker', this.setupWorker]])
    }

    /**
     * Refuse an interruption table rather than applying it.
     *
     * A WAV file holds one continuous span of PCM samples, so recording time and data time are the
     * same measurement and a sample position needs no gap arithmetic to reach it. A table saying
     * otherwise describes a timeline this reader does not serve: honouring it would displace every
     * later read by the gaps it declares, and return samples that still look entirely plausible. An
     * empty table asserts nothing and is passed on, since it is also how a caller marks the timing
     * of a recording fully known.
     *
     * Registered over the shared handler rather than inherited: the handlers running here are
     * `SignalReaderWorker`'s own, so the refusal stated in
     * [wav.worker.ts](../workers/wav.worker.ts) is not in this chain and has to be stated again.
     * @param msgData - Data property from the commission.
     */
    // The handler contract is asynchronous because most commissions read or decode. This one only
    // records a table, but the signature is the vocabulary's rather than this handler's.
    // eslint-disable-next-line @typescript-eslint/require-await
    async setInterruptions (msgData: WorkerMessage['data']) {
        const data = this._validate(
            msgData as WorkerMessage['data'] & {
                complete?: boolean
                interruptions: [number, number][]
            },
            {
                complete: 'Boolean?',
                interruptions: 'Array',
            }
        )
        if (!data) {
            return false
        }
        if (data.interruptions.length) {
            return this._failure(
                msgData,
                `Cannot apply an interruption table to a WAV study: the samples are one continuous ` +
                `span, so recording time and data time are the same measurement.`
            )
        }
        this._reader.setInterruptions(new Map(data.interruptions), data.complete ?? false)
        return this._success(msgData)
    }

    /**
     * Open the study the commission describes.
     * @param msgData - Data property from the commission.
     */
    async setupWorker (msgData: WorkerMessage['data']) {
        const data = this._validate(
            msgData as WorkerMessage['data'] & {
                authHeader?: string
                file?: File
                url?: string
            },
            {
                // A local study is read from the File and a remote one from the URL, so neither can
                // be required on its own; `setupStudy` rejects a source that has neither.
                authHeader: 'String?',
                file: 'File?',
                url: 'String?',
            }
        )
        if (!data) {
            return false
        }
        if (!await this._reader.setupStudy({ authHeader: data.authHeader, file: data.file, url: data.url })) {
            return this._failure(msgData, `Setting up study failed.`)
        }
        return this._success(msgData, {
            dataLength: this._reader.dataLength,
            recordingLength: this._reader.totalLength,
        })
    }
}

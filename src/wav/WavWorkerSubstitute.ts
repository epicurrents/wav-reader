/**
 * Epicurrents WAV worker substitute. Allows using the WAV reader in the main thread without an actual worker.
 * @package    epicurrents/wav-reader
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { ServiceWorkerSubstitute } from '@epicurrents/core'
import { validateCommissionProps } from '@epicurrents/core/dist/util'
import type {
    ConfigChannelFilter,
    GetSignalsResponse,
    WorkerMessage,
    WorkerSubstitute,
} from '@epicurrents/core/dist/types'
import { Log } from 'scoped-event-log'
import WavReader from './WavReader'

const SCOPE = 'WavWorkerSubstitute'

export default class WavWorkerSubstitute extends ServiceWorkerSubstitute implements WorkerSubstitute {
    protected _reader: WavReader
    constructor () {
        super()
        if (!window.__EPICURRENTS__?.RUNTIME) {
            Log.error(`Reference to main application was not found!`, SCOPE)
        }
        this._reader = new WavReader(window.__EPICURRENTS__.RUNTIME!.SETTINGS)
        const updateCallback = (update: { [prop: string]: unknown }) => {
            if (update.action === 'cache-signals') {
                this.returnMessage(update as WorkerMessage['data'])
            }
        }
        this._reader.setUpdateCallback(updateCallback)
    }
    async postMessage (message: WorkerMessage['data']) {
        if (!message?.action) {
            return
        }
        const action = message.action
        Log.debug(`Received message with action ${action}.`, SCOPE)
        switch (action) {
            case 'cache-signals': {
                try {
                    const success = await this._reader.cacheSignals()
                    return this.returnSuccess({
                        ...message,
                        complete: success,
                    })
                } catch (e: unknown) {
                    Log.error(
                        `An error occurred while trying to cache signals, operation was aborted: ${
                            (e as Error).message
                        }.`,
                        SCOPE,
                        e as Error
                    )
                    return this.returnFailure(message)
                }
            }
            case 'get-signals': {
                // Extract job parameters.
                const data = validateCommissionProps(
                    message as WorkerMessage['data'] & {
                        config?: ConfigChannelFilter
                        range: number[]
                    },
                    {
                        config: 'Object?',
                        range: ['Number', 'Number'],
                    },
                    true,
                    this.returnMessage.bind(this)
                )
                if (!data) {
                    return
                }
                try {
                    const sigs = await this._reader.getSignals(data.range, data.config)
                    if (sigs) {
                        return this.returnSuccess({
                            ...message,
                            ...sigs,
                        } as WorkerMessage['data'] & Omit<GetSignalsResponse, 'success'>)
                    } else {
                        return this.returnFailure(message)
                    }
                } catch (e: unknown) {
                    Log.error(`Getting signals failed: ${(e as Error).message}.`, SCOPE, e as Error)
                    return this.returnFailure(message)
                }
            }
            case 'setup-cache': {
                // Duration is not a mandatory property.
                const duration = (message.dataDuration as number) || 0
                const cache = this._reader.setupCache(duration)
                return this.returnSuccess({
                    ...message,
                    cacheProperties: cache,
                })
            }
            case 'setup-worker': {
                const data = validateCommissionProps(
                    message as WorkerMessage['data'] & {
                        url?: string
                        authHeader?: string
                        file?: File
                    },
                    {
                        // A local study is read from the File and a remote one from the URL, so neither
                        // can be required on its own; `setupStudy` rejects a source that has neither.
                        url: 'String?',
                        authHeader: 'String?',
                        file: 'File?',
                    },
                    true,
                    this.returnMessage.bind(this)
                )
                if (!data) {
                    return
                }
                const result = await this._reader.setupStudy(
                    { authHeader: data.authHeader, file: data.file, url: data.url }
                )
                if (result) {
                    return this.returnSuccess({
                        ...message,
                        dataLength: this._reader.dataLength,
                        recordingLength: this._reader.totalLength,
                    })
                } else {
                    return this.returnFailure(message)
                }
            }
            default: {
                super.postMessage(message)
            }
        }
    }
}

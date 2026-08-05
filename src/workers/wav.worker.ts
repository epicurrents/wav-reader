/**
 * Epicurrents WAV file worker.
 * @package    epicurrents/wav-reader
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { SETTINGS } from '@epicurrents/core'
import type { ConfigChannelFilter, WorkerMessage } from '@epicurrents/core/dist/types'
import { validateCommissionProps } from '@epicurrents/core/dist/util'
import { Log } from 'scoped-event-log'
import WavReader from '#wav/WavReader'

const SCOPE = "wav.worker"

const READER = new WavReader(SETTINGS)

onmessage = async (message: WorkerMessage) => {
    if (!message?.data?.action) {
        return
    }
    const { action, rn } = message.data
    /** Return a success response to the service. */
    const returnSuccess = (results?: { [key: string]: unknown }) => {
        postMessage({
            rn: rn,
            action: action,
            success: true,
            ...results
        })
    }
    /** Return a failure response to the service. */
    const returnFailure = (error: string | string[]) => {
        postMessage({
            rn: rn,
            action: action,
            success: false,
            error: error,
        })
    }
    Log.debug(`Received message with action ${action}.`, SCOPE)
    switch (action) {
        case 'cache-signals': {
             try {
                const success = await READER.cacheSignals()
                // This will only return success once caching is complete.
                return returnSuccess({ complete: success })
            } catch (e: unknown) {
                Log.error(
                    `An error occurred while trying to cache signals, operation was aborted: ${(e as Error).message}.`,
                SCOPE, e as Error)
                return returnFailure((e as Error).message)
            }
        }
        case 'get-signals': {
            if (!READER.cacheReady) {
                return returnFailure(`Cannot return signals if signal cache is not yet initialized.`)
            }
            const data = validateCommissionProps(
                message.data as WorkerMessage['data'] & {
                    config?: ConfigChannelFilter
                    range: number[]
                },
                {
                    config: 'Object?',
                    range: ['Number', 'Number'],
                }
            )
            if (!data) {
                return
            }
            try {
                const sigs = await READER.getSignals(data.range, data.config)
                if (sigs) {
                    return returnSuccess({
                        range: message.data.range,
                        ...sigs
                    })
                } else {
                    return returnFailure(`Reader did not return any signals.`)
                }
            } catch (e: unknown) {
                return returnFailure((e as Error).message)
            }
        }
        case 'release-cache': {
            await READER.releaseCache()
            return returnSuccess()
        }
        case 'setup-cache': {
            if (message.data.useMemoryManager) {
                const data = validateCommissionProps(
                    message.data as WorkerMessage['data'] & {
                        buffer: SharedArrayBuffer
                        range: { start: number }
                    },
                    {
                        buffer: 'SharedArrayBuffer',
                        range: 'Object',
                    }
                )
                if (!data) {
                    // This already returned a failure response.
                    return
                }
                const exportProps = await READER.setupMutex(data.buffer, data.range.start)
                if (exportProps) {
                    // Pass the generated shared buffers back to main thread.
                    return returnSuccess({
                        cacheProperties: exportProps,
                    })
                } else {
                    return returnFailure(`Mutex setup failed.`)
                }
            } else {
                // Duration is not a mandatory property.
                const duration = (message.data.dataDuration as number) || 0
                const success = READER.setupCache(duration)
                if (success) {
                    return returnSuccess()
                } else {
                    return returnFailure(`Cache setup failed.`)
                }
            }
        }
        case 'setup-worker': {
            const data = validateCommissionProps(
                message.data as WorkerMessage['data'] & {
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
                }
            )
            if (!data) {
                return returnFailure(`Validating commission props failed.`)
            }
            if (await READER.setupStudy({ authHeader: data.authHeader, file: data.file, url: data.url })) {
                return returnSuccess({
                    dataLength: READER.dataLength,
                    recordingLength: READER.totalLength,
                })
            } else {
                return returnFailure(`Setting up study failed.`)
            }
        }
        case 'shutdown': {
            await READER.destroy()
            close()
            return returnSuccess()
        }
        case 'update-settings': {
            Object.assign(SETTINGS, message.data.settings)
            return returnSuccess()
        }
    }
}

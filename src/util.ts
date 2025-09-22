/**
 * Epicurrents WAV reader utilities.
 * @package    epicurrents/wav-reader
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { GenericBiosignalHeader } from '@epicurrents/core'
import type { BiosignalHeaderSignal } from '@epicurrents/core/dist/types'
import type { WavHeader } from '#types'

/**
 * Convert the given WAV header record into generic biosignal headers.
 * @param header - Parsed WAV header.
 * @returns Biosignal header record.
 */
export const headerToBiosignalHeader = (header: WavHeader) => {
    const channels: BiosignalHeaderSignal[] = []
    for (let i=0; i<header.nChannels; i++) {
        channels.push({
            label: `Chan ${i+1}`,
            modality: 'signal',
            name: `channel_${i}`,
            physicalUnit: 'uV',
            prefiltering: { bandreject: [], highpass: 0, lowpass: 0, notch: 0 },
            sampleCount: header.nSamples,
            samplingRate: header.samplingRate,
            sensitivity: 1,
            sensor: '',
        })
    }
    const biosigHeaders = new GenericBiosignalHeader(
        'wav',
        'Unknown',
        'Unknown',
        // We will use 1 second data unit length.
        header.duration,
        1,
        header.samplingRate,
        header.nChannels,
        channels
    )
    return biosigHeaders
}

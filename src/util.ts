/**
 * Epicurrents WAV reader utilities.
 * @package    epicurrents/wav-reader
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { GenericBiosignalHeader } from '@epicurrents/core'
import type { BiosignalHeaderSignal } from '@epicurrents/core/types'
import type { WavCalibration, WavHeader } from '#types'

/** Magnitude of the most negative signed 16-bit integer, the full scale a calibration is stated against. */
export const MAX_SIGNED_16BIT = 32_768
/** Calibration of a file nobody calibrated: each stored integer is one microvolt. */
export const DEFAULT_CALIBRATION: Required<WavCalibration> = Object.freeze({
    physicalMax: MAX_SIGNED_16BIT,
    physicalUnit: 'uV',
})

/**
 * Check a calibration and complete it with the default unit.
 *
 * Refused rather than repaired: a zero, negative or non-finite full scale turns every sample into zero, a flipped
 * trace or NaN, and a unit that is not a string reaches the channel headers as whatever it is.
 * @param calibration - The calibration a host supplied.
 * @returns The completed calibration, or a reason it was refused.
 */
export const validateCalibration = (
    calibration: unknown
): { calibration: Required<WavCalibration> } | { reason: string } => {
    if (!calibration || typeof calibration !== 'object') {
        return { reason: `a calibration must be an object with a physicalMax property.` }
    }
    const { physicalMax, physicalUnit } = calibration as Partial<WavCalibration>
    if (typeof physicalMax !== 'number' || !Number.isFinite(physicalMax) || physicalMax <= 0) {
        return { reason: `physicalMax must be a finite number above zero, received ${String(physicalMax)}.` }
    }
    if (physicalUnit !== undefined && (typeof physicalUnit !== 'string' || !physicalUnit.trim())) {
        return { reason: `physicalUnit must be a non-empty string when given.` }
    }
    return { calibration: { physicalMax, physicalUnit: physicalUnit?.trim() ?? DEFAULT_CALIBRATION.physicalUnit } }
}

/**
 * Convert the given WAV header record into generic biosignal headers.
 * @param header - Parsed WAV header.
 * @param physicalUnit - Unit every channel is measured in (default `uV`).
 * @returns Biosignal header record.
 */
export const headerToBiosignalHeader = (header: WavHeader, physicalUnit = DEFAULT_CALIBRATION.physicalUnit) => {
    const channels: BiosignalHeaderSignal[] = []
    for (let i=0; i<header.nChannels; i++) {
        channels.push({
            label: `Chan ${i+1}`,
            modality: 'signal',
            name: `channel_${i}`,
            physicalUnit,
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

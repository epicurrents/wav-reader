/**
 * Epicurrents WAV file reader tests.
 * Due to the high level of integration, tests must be run sequentially.
 * This file describes the testing sequence and runs the appropriate tests.
 * @package    epicurrents/wav-reader
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import WavReader from '../src/WavReader'

describe('Epicurrents WAV file reader tests', () => {
    test('Create and instance of file loader', () => {
        const loader = new WavReader('')
        expect(loader).toBeDefined()
    })
})

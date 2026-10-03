/**
 * Epicurrents WAV reader. The package's public surface is the importer a consumer registers with a
 * study loader, and the substitute that serves a study without a worker.
 * @package    epicurrents/wav-reader
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import WavImporter from '#wav/WavImporter'
import WavWorkerSubstitute from '#wav/WavWorkerSubstitute'

export {
    WavImporter,
    WavWorkerSubstitute,
}

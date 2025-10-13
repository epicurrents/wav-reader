const path = require('path')
const TerserPlugin = require('terser-webpack-plugin')
require('dotenv').config()

const ASSET_PATH = process.env.ASSET_PATH || '/wav-reader/'

module.exports = {
    mode: 'production',
    entry: {
        'wav-reader': { import: path.join(__dirname, 'src', 'index.ts') },
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: 'ts-loader',
                exclude: '/node_modules/',
            },
        ],
    },
    optimization: {
        minimize: true,
        minimizer: [
            new TerserPlugin(),
        ],
        splitChunks: false,
    },
    output: {
        path: path.resolve(__dirname, 'umd'),
        publicPath: ASSET_PATH,
        library: 'EpicWavReader',
        libraryTarget: 'umd',
    },
    resolve: {
        extensions: ['.ts', '.js', '.json'],
        alias: {
            '#root': path.resolve(__dirname, './'),
            '#util': path.resolve(__dirname, 'src', 'util'),
            '#wav': path.resolve(__dirname, 'src', 'wav'),
            '#types': path.resolve(__dirname, 'src', 'types'),
            '#workers': path.resolve(__dirname, 'src', 'workers'),
        },
        symlinks: false
    },
}

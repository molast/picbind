/* tslint:disable */
/* eslint-disable */

/**
 * Chroma subsampling format
 */
export enum ChromaSampling {
    /**
     * Both vertically and horizontally subsampled.
     */
    Cs420 = 0,
    /**
     * Horizontally subsampled.
     */
    Cs422 = 1,
    /**
     * Not subsampled.
     */
    Cs444 = 2,
    /**
     * Monochrome.
     */
    Cs400 = 3,
}

export class CompressionResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly bytes: Uint8Array;
    readonly ext: string;
    readonly mime: string;
}

export function analyze_image_metrics(input: Uint8Array): any;

export function calculate_image_quality_score(original_input: Uint8Array, assessed_input: Uint8Array): any;

export function compare_image_quality(original_input: Uint8Array, compressed_input: Uint8Array): any;

export function compress_image(input: Uint8Array, quality: number): CompressionResult;

export function compress_image_to_format(input: Uint8Array, quality: number, target_format: string): CompressionResult;

export function compress_image_to_format_with_options(input: Uint8Array, quality: number, target_format: string, allow_alpha_loss: boolean): CompressionResult;

export function compress_png_with_deflate(input: Uint8Array, compression_level: number): CompressionResult;

export function create_zip_from_items(items: Array<any>): Uint8Array;

export function generate_favicon(input: Uint8Array): object;

export function generate_share_placeholder(input: Uint8Array): object;

export function generate_share_thumbnail(input: Uint8Array): Uint8Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_compressionresult_free: (a: number, b: number) => void;
    readonly analyze_image_metrics: (a: number, b: number) => [number, number, number];
    readonly calculate_image_quality_score: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly compress_image: (a: number, b: number, c: number) => [number, number, number];
    readonly compress_image_to_format: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly compress_image_to_format_with_options: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly compress_png_with_deflate: (a: number, b: number, c: number) => [number, number, number];
    readonly compressionresult_bytes: (a: number) => [number, number];
    readonly compressionresult_ext: (a: number) => [number, number];
    readonly compressionresult_mime: (a: number) => [number, number];
    readonly create_zip_from_items: (a: any) => [number, number, number, number];
    readonly generate_favicon: (a: number, b: number) => [number, number, number];
    readonly generate_share_placeholder: (a: number, b: number) => [number, number, number];
    readonly generate_share_thumbnail: (a: number, b: number) => [number, number, number, number];
    readonly lodepng_add_itext: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly lodepng_add_text: (a: number, b: number, c: number) => number;
    readonly lodepng_auto_choose_color: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly lodepng_buffer_file: (a: number, b: number, c: number) => number;
    readonly lodepng_can_have_alpha: (a: number) => number;
    readonly lodepng_chunk_ancillary: (a: number) => number;
    readonly lodepng_chunk_append: (a: number, b: number, c: number) => number;
    readonly lodepng_chunk_check_crc: (a: number) => number;
    readonly lodepng_chunk_create: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly lodepng_chunk_data: (a: number) => number;
    readonly lodepng_chunk_data_const: (a: number) => number;
    readonly lodepng_chunk_generate_crc: (a: number) => void;
    readonly lodepng_chunk_length: (a: number) => number;
    readonly lodepng_chunk_next: (a: number) => number;
    readonly lodepng_chunk_private: (a: number) => number;
    readonly lodepng_chunk_safetocopy: (a: number) => number;
    readonly lodepng_chunk_type: (a: number, b: number) => void;
    readonly lodepng_chunk_type_equals: (a: number, b: number) => number;
    readonly lodepng_clear_itext: (a: number) => void;
    readonly lodepng_clear_text: (a: number) => void;
    readonly lodepng_color_mode_cleanup: (a: number) => void;
    readonly lodepng_color_mode_copy: (a: number, b: number) => number;
    readonly lodepng_color_mode_equal: (a: number, b: number) => number;
    readonly lodepng_color_mode_init: (a: number) => void;
    readonly lodepng_color_profile_init: (a: number) => void;
    readonly lodepng_compress_settings_init: (a: number) => void;
    readonly lodepng_convert: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly lodepng_crc32: (a: number, b: number) => number;
    readonly lodepng_decode: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly lodepng_decode24: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly lodepng_decode_memory: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly lodepng_decode24_file: (a: number, b: number, c: number, d: number) => number;
    readonly lodepng_decode_file: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly lodepng_decode32: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly lodepng_decode32_file: (a: number, b: number, c: number, d: number) => number;
    readonly lodepng_decoder_settings_init: (a: number) => void;
    readonly lodepng_decompress_settings_init: (a: number) => void;
    readonly lodepng_encode: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly lodepng_encode24: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly lodepng_encode24_file: (a: number, b: number, c: number, d: number) => number;
    readonly lodepng_encode32: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly lodepng_encode32_file: (a: number, b: number, c: number, d: number) => number;
    readonly lodepng_encode_file: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly lodepng_encode_memory: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly lodepng_encoder_settings_init: (a: number) => void;
    readonly lodepng_error_text: (a: number) => number;
    readonly lodepng_filesize: (a: number) => number;
    readonly lodepng_free: (a: number) => void;
    readonly lodepng_get_bpp: (a: number) => number;
    readonly lodepng_get_bpp_lct: (a: number, b: number) => number;
    readonly lodepng_get_channels: (a: number) => number;
    readonly lodepng_get_color_profile: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly lodepng_get_raw_size: (a: number, b: number, c: number) => number;
    readonly lodepng_get_raw_size_lct: (a: number, b: number, c: number, d: number) => number;
    readonly lodepng_has_palette_alpha: (a: number) => number;
    readonly lodepng_info_cleanup: (a: number) => void;
    readonly lodepng_info_copy: (a: number, b: number) => number;
    readonly lodepng_info_init: (a: number) => void;
    readonly lodepng_info_swap: (a: number, b: number) => void;
    readonly lodepng_inspect: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly lodepng_is_alpha_type: (a: number) => number;
    readonly lodepng_is_greyscale_type: (a: number) => number;
    readonly lodepng_is_palette_type: (a: number) => number;
    readonly lodepng_load_file: (a: number, b: number, c: number) => number;
    readonly lodepng_malloc: (a: number) => number;
    readonly lodepng_palette_add: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly lodepng_palette_clear: (a: number) => void;
    readonly lodepng_realloc: (a: number, b: number) => number;
    readonly lodepng_save_file: (a: number, b: number, c: number) => number;
    readonly lodepng_state_cleanup: (a: number) => void;
    readonly lodepng_state_copy: (a: number, b: number) => number;
    readonly lodepng_state_init: (a: number) => void;
    readonly lodepng_zlib_compress: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly lodepng_zlib_decompress: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly zlib_compress: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly zlib_decompress: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly lodepng_chunk_next_const: (a: number) => number;
    readonly compare_image_quality: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;

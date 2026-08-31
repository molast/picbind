/* tslint:disable */
/* eslint-disable */

export class CompressionResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly bytes: Uint8Array;
    readonly ext: string;
    readonly mime: string;
}

export class MaterializedPixels {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly bytes: Uint8Array;
    readonly height: number;
    readonly width: number;
}

export function analyze_image_metrics(input: Uint8Array): any;

export function calculate_image_md5(input: Uint8Array): string;

export function calculate_image_quality_score(original_input: Uint8Array, assessed_input: Uint8Array): any;

export function compare_avif_candidate_quality(original_input: Uint8Array, candidate_input: Uint8Array): any;

export function compare_avif_candidate_rgba(original_rgba: Uint8Array, candidate_rgba: Uint8Array, width: number, height: number): any;

export function compare_image_quality(original_input: Uint8Array, compressed_input: Uint8Array): any;

export function compare_image_quality_for_guardrails(original_input: Uint8Array, compressed_input: Uint8Array): any;

export function compress_image(input: Uint8Array, quality: number): CompressionResult;

export function compress_image_to_format(input: Uint8Array, quality: number, target_format: string): CompressionResult;

export function compress_image_to_format_with_options(input: Uint8Array, quality: number, target_format: string, allow_alpha_loss: boolean): CompressionResult;

export function compress_image_to_format_with_plan_options(input: Uint8Array, quality: number, target_format: string, allow_alpha_loss: boolean, compression_gain: number): CompressionResult;

export function compress_image_to_format_with_resize_options(input: Uint8Array, quality: number, target_format: string, allow_alpha_loss: boolean, compression_gain: number, target_width: number, target_height: number): CompressionResult;

export function compress_png_with_deflate(input: Uint8Array, compression_level: number): CompressionResult;

export function compress_rgba_to_png(rgba: Uint8Array, width: number, height: number, quality: number, source_size_bytes: number): CompressionResult;

export function compress_rgba_to_png_with_gain(rgba: Uint8Array, width: number, height: number, quality: number, source_size_bytes: number, compression_gain: number): CompressionResult;

export function create_avif_encoding_plan(input: Uint8Array, quality: number, source_size_bytes: number): any;

export function create_avif_encoding_plan_rgba(rgba: Uint8Array, width: number, height: number, quality: number, source_size_bytes: number): any;

export function create_avif_encoding_plan_rgba_with_gain(rgba: Uint8Array, width: number, height: number, quality: number, source_size_bytes: number, compression_gain: number): any;

export function create_zip_from_items(items: Array<any>): Uint8Array;

export function generate_favicon(input: Uint8Array): object;

export function generate_share_placeholder(input: Uint8Array): object;

export function generate_share_placeholder_from_rgba(width: number, height: number, sample_width: number, sample_height: number, rgba: Uint8Array): object;

export function generate_share_preview_thumbnail(input: Uint8Array, container_width: number, container_height: number): Uint8Array;

export function generate_share_preview_thumbnail_from_rgba(width: number, height: number, rgba: Uint8Array): Uint8Array;

export function generate_share_thumbnail(input: Uint8Array): Uint8Array;

export function materialize_image_operations_to_rgba(input: Uint8Array, document_json: string): MaterializedPixels;

export function materialize_rgba_operations_to_rgba(rgba: Uint8Array, width: number, height: number, document_json: string): MaterializedPixels;

export function predict_compression(input: Uint8Array): any;

export function predict_compression_rgba(rgba: Uint8Array, width: number, height: number, source_size_bytes: number, source_format: string): any;

export function read_image_metadata(input: Uint8Array): object;

export function render_image_operations_preview_to_rgba(input: Uint8Array, document_json: string, max_width: number, max_height: number): MaterializedPixels;

export function resize_image_to_rgba(input: Uint8Array, target_width: number, target_height: number): Uint8Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_compressionresult_free: (a: number, b: number) => void;
    readonly __wbg_materializedpixels_free: (a: number, b: number) => void;
    readonly analyze_image_metrics: (a: number, b: number) => [number, number, number];
    readonly calculate_image_md5: (a: number, b: number) => [number, number, number, number];
    readonly calculate_image_quality_score: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly compare_avif_candidate_quality: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly compare_avif_candidate_rgba: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly compare_image_quality: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly compare_image_quality_for_guardrails: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly compress_image: (a: number, b: number, c: number) => [number, number, number];
    readonly compress_image_to_format: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly compress_image_to_format_with_options: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly compress_image_to_format_with_plan_options: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly compress_image_to_format_with_resize_options: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number];
    readonly compress_png_with_deflate: (a: number, b: number, c: number) => [number, number, number];
    readonly compress_rgba_to_png: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly compress_rgba_to_png_with_gain: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly compressionresult_bytes: (a: number) => [number, number];
    readonly compressionresult_ext: (a: number) => [number, number];
    readonly compressionresult_mime: (a: number) => [number, number];
    readonly create_avif_encoding_plan: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly create_avif_encoding_plan_rgba: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly create_avif_encoding_plan_rgba_with_gain: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly create_zip_from_items: (a: any) => [number, number, number, number];
    readonly generate_favicon: (a: number, b: number) => [number, number, number];
    readonly generate_share_placeholder: (a: number, b: number) => [number, number, number];
    readonly generate_share_placeholder_from_rgba: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly generate_share_preview_thumbnail: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly generate_share_preview_thumbnail_from_rgba: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly generate_share_thumbnail: (a: number, b: number) => [number, number, number, number];
    readonly materialize_image_operations_to_rgba: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly materialize_rgba_operations_to_rgba: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly materializedpixels_bytes: (a: number) => [number, number];
    readonly materializedpixels_height: (a: number) => number;
    readonly materializedpixels_width: (a: number) => number;
    readonly predict_compression: (a: number, b: number) => [number, number, number];
    readonly predict_compression_rgba: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly read_image_metadata: (a: number, b: number) => [number, number, number];
    readonly render_image_operations_preview_to_rgba: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly resize_image_to_rgba: (a: number, b: number, c: number, d: number) => [number, number, number, number];
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

export type PicBindUiConfig = {
  wasmBaseUrl?: string;
};

const runtimeConfig: PicBindUiConfig = {};

export function configurePicBindUi(config: PicBindUiConfig) {
  Object.assign(runtimeConfig, config);
}

export function getPicBindUiConfig() {
  return runtimeConfig;
}

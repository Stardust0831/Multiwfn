/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MATTERVIZ_PRERELEASE_UPDATER?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

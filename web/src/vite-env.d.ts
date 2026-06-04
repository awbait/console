/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEV_AUTH?: string;
  readonly VITE_DEV_TEAMS?: string;
  readonly VITE_DEV_ROLE?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

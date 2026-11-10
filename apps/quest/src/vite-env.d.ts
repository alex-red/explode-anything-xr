/// <reference types="vite/client" />
/// <reference types="@iwsdk/vite-plugin-dev/client" />

interface ImportMetaEnv {
  /** Optional live tutor proxy base URL (services/tutor-proxy). Unset = offline scripted tutor only. */
  readonly VITE_TUTOR_URL?: string;
}

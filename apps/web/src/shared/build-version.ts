declare const __KDOS_BUILD_SHA__: string;

export type BuildVersion = { commit: string; shortCommit: string };

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;

export function resolveBuildVersion(value: unknown): BuildVersion {
  const commit = String(value ?? "").trim().toLowerCase();
  if (!FULL_GIT_SHA.test(commit)) return { commit: "unknown", shortCommit: "unknown" };
  return { commit, shortCommit: commit.slice(0, 7) };
}

const embeddedBuildSha = typeof __KDOS_BUILD_SHA__ === "string" ? __KDOS_BUILD_SHA__ : "unknown";
export const webBuildVersion = resolveBuildVersion(embeddedBuildSha);

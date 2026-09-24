export type BuildVersion = { commit: string; shortCommit: string };

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;

export function resolveBuildVersion(value: unknown = process.env.KDOS_BUILD_SHA): BuildVersion {
  const commit = String(value ?? "").trim().toLowerCase();
  if (!FULL_GIT_SHA.test(commit)) return { commit: "unknown", shortCommit: "unknown" };
  return { commit, shortCommit: commit.slice(0, 7) };
}

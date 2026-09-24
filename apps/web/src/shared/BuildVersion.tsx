import { resolveBuildVersion, webBuildVersion } from "./build-version";

export function BuildVersionLabel({ className, commit = webBuildVersion.commit }: { className?: string; commit?: string }) {
  const version = resolveBuildVersion(commit);
  return <span className={className} title={`完整版本：${version.commit}`}>版本：{version.shortCommit}</span>;
}

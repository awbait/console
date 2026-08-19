// Where a version of the portal is written down, and how to get there.
//
// The build the portal runs is not always a release: between releases it is
// stamped from git as "v0.4.0-10-g2574d9b". Such a build is described by the
// "Unreleased" section of the changelog, because that is what it is - everything
// merged since the last release. A build that is a release has a section of its
// own to scroll to.

const RELEASE = /^v?(\d+\.\d+\.\d+)$/;

// The id of the changelog section a version belongs to. Used on both ends: the
// About page marks its sections with it, and a link to a version is built from
// it, so the two cannot disagree about where a version lives.
export function releaseAnchor(version: string): string {
  const m = RELEASE.exec(version.trim());
  return m ? `release-${m[1]}` : "release-unreleased";
}

// Whether a version string names a release, rather than a build somewhere after
// one.
export function isRelease(version: string): boolean {
  return RELEASE.test(version.trim());
}

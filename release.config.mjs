/**
 * semantic-release configuration.
 *
 * Releases are driven entirely by Conventional Commits on `main`: the commit
 * types below decide the version bump, and nothing is published unless a
 * releasable commit landed.
 *
 * @see https://semantic-release.gitbook.io/semantic-release/usage/configuration
 * @type {import('semantic-release').GlobalConfig}
 */

/**
 * The Conventional Commits preset, rather than semantic-release's bundled
 * Angular default.
 *
 * This is not cosmetic. The Angular preset does not understand the `!`
 * breaking-change marker, so `feat!: …` analyses as **no release at all** —
 * verified, not assumed. This repository already uses that form.
 *
 * Pinned to the 9.x line on purpose: 10.x switched to
 * `@conventional-changelog/template` and requires
 * `conventional-changelog-writer@9`, while `@semantic-release/release-notes-generator@14`
 * still depends on writer 8. Installing 10.x makes note generation throw
 * `Missing helper`. Do not bump the major until release-notes-generator ships
 * writer 9 support.
 */
const preset = 'conventionalcommits';

export default {
  branches: ['main'],
  plugins: [
    [
      '@semantic-release/commit-analyzer',
      {
        preset,
        // Types absent from this list keep the preset's default behaviour:
        // `feat` minor, `fix` patch, and any `!`/`BREAKING CHANGE` major.
        releaseRules: [
          // A README fix is worth shipping; other docs churn is not.
          { type: 'docs', scope: 'readme', release: 'patch' },
          { type: 'perf', release: 'patch' },
          { type: 'revert', release: 'patch' },
          { type: 'build', release: false },
          { type: 'ci', release: false },
          { type: 'chore', release: false },
          { type: 'refactor', release: false },
          { type: 'style', release: false },
          { type: 'test', release: false },
        ],
      },
    ],
    [
      '@semantic-release/release-notes-generator',
      {
        preset,
        presetConfig: {
          types: [
            { type: 'feat', section: 'Features' },
            { type: 'fix', section: 'Bug Fixes' },
            { type: 'perf', section: 'Performance' },
            { type: 'revert', section: 'Reverts' },
            { type: 'docs', section: 'Documentation', hidden: false },
            { type: 'build', section: 'Build System', hidden: false },
            // Noise for consumers of the changelog.
            { type: 'refactor', hidden: true },
            { type: 'style', hidden: true },
            { type: 'test', hidden: true },
            { type: 'ci', hidden: true },
            { type: 'chore', hidden: true },
          ],
        },
      },
    ],
    '@semantic-release/changelog',

    // Publishes to npmjs.com. No token is configured anywhere: the release
    // workflow authenticates with npm trusted publishing over OIDC, which also
    // produces the provenance attestation on its own.
    '@semantic-release/npm',

    [
      '@semantic-release/git',
      {
        assets: ['CHANGELOG.md', 'package.json'],
        // `[skip ci]` keeps this commit from triggering another release run.
        message:
          'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
      },
    ],

    // Last, so the GitHub release links a changelog that already exists.
    '@semantic-release/github',
  ],
};

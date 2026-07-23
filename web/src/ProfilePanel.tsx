import type { ProfileRecord, TreeNodeSummary } from "./api";
import { surfaceScoreToCss } from "./surfaceColor";

interface Props {
  profile: ProfileRecord | null;
  node: TreeNodeSummary | null;
  loading: boolean;
  error: string | null;
  expanding: boolean;
  onClose: () => void;
  onExpandBranch?: () => void;
}

function LinkRow({ href, label }: { href?: string; label: string }) {
  if (!href) return null;
  return (
    <a className="plink" href={href} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}

export function ProfilePanel({
  profile,
  node,
  loading,
  error,
  expanding,
  onClose,
  onExpandBranch,
}: Props) {
  if (!profile && !loading && !error) return null;

  const hasLinkedIn = !!(
    node?.has_linkedin ||
    node?.linkedin_url ||
    node?.can_expand ||
    profile?.links?.linkedin_url ||
    profile?.linkedin?.url ||
    profile?.github?.social_accounts?.some(
      (s) => s.provider.toLowerCase() === "linkedin" && s.url
    ) ||
    profile?.links?.social_accounts?.some(
      (s) => s.provider.toLowerCase() === "linkedin" && s.url
    )
  );
  const websiteUrl =
    node?.website_url ||
    profile?.links?.personal_website ||
    profile?.website?.url ||
    undefined;
  const blogUrl =
    node?.blog_url ||
    profile?.links?.blog ||
    profile?.github?.blog ||
    undefined;
  const hasWriting = !!(
    node?.has_writing_surface ||
    websiteUrl ||
    blogUrl
  );
  const surfaceScore = node?.surface_score ?? 0;
  const surfaceMax = node?.surface_score_max ?? 12;
  const surfaceSignals = node?.surface_signals ?? [];
  const hop = node?.hop ?? profile?.hop ?? (node?.relation === "seed" ? 0 : 1);
  const canExpand =
    !!onExpandBranch &&
    hop === 1 &&
    node?.relation !== "seed" &&
    hasLinkedIn;

  return (
    <aside className={`panel ${profile || loading || error ? "open" : ""}`}>
      <div className="panel-head">
        <button type="button" className="panel-close" onClick={onClose}>
          Close
        </button>
      </div>

      {loading && <p className="muted">Loading profile…</p>}
      {error && <p className="error">{error}</p>}

      {profile && (
        <div className="panel-body">
          <p className="eyebrow">
            {profile.relation}
            {typeof profile.hop === "number" && profile.hop > 0
              ? ` · hop ${profile.hop}`
              : ""}
            {profile.relation !== "seed" &&
              ` · context ${profile.context_score}`}
          </p>
          <h2>{profile.name}</h2>

          <div className="surface-meter" aria-label="Identity surface score">
            <div className="surface-meter-head">
              <span
                className="surface-dot"
                style={{
                  background: surfaceScoreToCss(surfaceScore, surfaceMax),
                }}
              />
              <span>
                Surface {surfaceScore}/{surfaceMax}
              </span>
            </div>
            <div className="surface-meter-track">
              <div
                className="surface-meter-fill"
                style={{
                  width: `${Math.min(100, (surfaceScore / surfaceMax) * 100)}%`,
                  background: surfaceScoreToCss(
                    Math.max(surfaceScore, 0.5),
                    surfaceMax
                  ),
                }}
              />
            </div>
            <p className="muted surface-meter-hint">
              LinkedIn + site/blog weigh more than X; email is high-value for
              outreach; GitHub not counted.
            </p>
          </div>

          <div className="chips presence-chips" aria-label="Identity surfaces">
            <span
              className={`chip ${hasLinkedIn ? "chip-on" : "chip-off"}`}
              title="LinkedIn (+4)"
            >
              LinkedIn
            </span>
            <span
              className={`chip ${hasWriting ? "chip-on" : "chip-off"}`}
              title="Personal website or blog (+4)"
            >
              Website/blog
            </span>
            {surfaceSignals
              .filter((s) => s !== "linkedin" && s !== "writing")
              .map((s) => (
                <span key={s} className="chip chip-on" title="Lower weight">
                  {s}
                </span>
              ))}
          </div>

          {canExpand && (
            <button
              type="button"
              className="expand-btn"
              disabled={expanding}
              onClick={onExpandBranch}
            >
              {expanding ? "Expanding…" : "Expand branch"}
            </button>
          )}

          {!canExpand && hop === 1 && node?.relation !== "seed" && (
            <p className="muted" style={{ marginTop: "0.5rem" }}>
              No LinkedIn on this GitHub profile — branch expand unavailable.
            </p>
          )}

          {profile.linkedin?.headline && (
            <p className="headline">{profile.linkedin.headline}</p>
          )}
          {(profile.linkedin?.college || profile.linkedin?.school) && (
            <p className="muted">
              {profile.linkedin.college || profile.linkedin.school}
            </p>
          )}

          {profile.context_signals?.length > 0 && (
            <div className="chips">
              {profile.context_signals.map((s) => (
                <span key={s} className="chip">
                  {s}
                </span>
              ))}
            </div>
          )}

          <div className="plink-row">
            <LinkRow href={profile.links?.github_url} label="GitHub" />
            <LinkRow
              href={profile.links?.linkedin_url || node?.linkedin_url}
              label="LinkedIn"
            />
            <LinkRow href={websiteUrl || blogUrl} label="Website" />
            <LinkRow href={profile.links?.twitter_url} label="Twitter" />
            {profile.links?.email && (
              <LinkRow
                href={`mailto:${profile.links.email}`}
                label={profile.links.email}
              />
            )}
          </div>

          {profile.github?.bio && (
            <section>
              <h3>Bio</h3>
              <p>{profile.github.bio}</p>
            </section>
          )}

          {(profile.github?.company || profile.github?.location) && (
            <section>
              <h3>GitHub</h3>
              {profile.github.company && <p>{profile.github.company}</p>}
              {profile.github.location && (
                <p className="muted">{profile.github.location}</p>
              )}
            </section>
          )}

          {profile.github?.repos && profile.github.repos.length > 0 && (
            <section>
              <h3>Top repos</h3>
              <ul className="repo-list">
                {[...profile.github.repos]
                  .sort((a, b) => b.stars - a.stars)
                  .slice(0, 6)
                  .map((r) => (
                    <li key={r.name}>
                      <span>{r.name}</span>
                      <span className="muted">
                        {r.stars}★{r.language ? ` · ${r.language}` : ""}
                      </span>
                    </li>
                  ))}
              </ul>
            </section>
          )}

          {profile.olympiad?.prizes && profile.olympiad.prizes.length > 0 && (
            <section>
              <h3>Olympiad</h3>
              <ul>
                {profile.olympiad.prizes.slice(0, 5).map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </section>
          )}

          {profile.website?.url && (
            <section>
              <h3>Website scrape</h3>
              <p className="muted">{profile.website.url}</p>
              {profile.website.email && <p>{profile.website.email}</p>}
            </section>
          )}
        </div>
      )}
    </aside>
  );
}

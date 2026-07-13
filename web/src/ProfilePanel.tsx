import type { ProfileRecord } from "./api";

interface Props {
  profile: ProfileRecord | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}

function LinkRow({ href, label }: { href?: string; label: string }) {
  if (!href) return null;
  return (
    <a className="plink" href={href} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}

export function ProfilePanel({ profile, loading, error, onClose }: Props) {
  if (!profile && !loading && !error) return null;

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
            {profile.relation !== "seed" &&
              ` · context ${profile.context_score}`}
          </p>
          <h2>{profile.name}</h2>

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
            <LinkRow href={profile.links?.linkedin_url} label="LinkedIn" />
            <LinkRow
              href={profile.links?.personal_website || profile.links?.blog}
              label="Website"
            />
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

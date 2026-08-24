import { useEffect, useState } from "react";
import {
  deleteMark,
  fetchCandidates,
  fetchCandidateFeedback,
  fetchLatestCandidateAssessment,
  fetchMarks,
  putMark,
  sendCandidateFeedback,
  type CandidateAssessmentDetail,
  type FeedbackVerdict,
  type ProfileRecord,
  type TreeNodeSummary,
} from "./api";
import { surfaceScoreToCss } from "./surfaceColor";
import { AssessmentResultView } from "./AssessmentResultView";
import { WebsiteGraphPanel } from "./WebsiteGraphPanel";
import { previewablePageUrls } from "./previewablePageUrls";

interface Props {
  profile: ProfileRecord | null;
  node: TreeNodeSummary | null;
  loading: boolean;
  error: string | null;
  expanding: boolean;
  pipelineRunning?: boolean;
  seedSlug?: string | null;
  onClose: () => void;
  onExpandBranch?: () => void;
  onAssessCandidate?: (candidateId: string) => void;
  onWebsiteRun?: (runId: string) => Promise<void>;
  onError?: (message: string) => void;
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
  pipelineRunning = false,
  seedSlug,
  onClose,
  onExpandBranch,
  onAssessCandidate,
  onWebsiteRun,
  onError,
}: Props) {
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [assessment, setAssessment] = useState<CandidateAssessmentDetail | null>(null);
  const [assessmentLoading, setAssessmentLoading] = useState(false);
  const [feedbackVerdict, setFeedbackVerdict] = useState<FeedbackVerdict | null>(null);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [marked, setMarked] = useState(false);
  const [markBusy, setMarkBusy] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);

  const markId = candidateId ?? profile?.slug ?? null;

  useEffect(() => {
    const url =
      node?.website_url ||
      profile?.links?.personal_website ||
      profile?.website?.url ||
      undefined;
    setSiteOpen(profile?.relation === "seed" && Boolean(url));
    setMarked(false);
    if (!markId) return;
    let cancelled = false;
    void fetchMarks()
      .then((rows) => {
        if (!cancelled) setMarked(rows.some((m) => m.id === markId));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [markId, node, profile]);

  useEffect(() => {
    setFeedbackVerdict(null);
    if (!candidateId) return;
    let cancelled = false;
    void fetchCandidateFeedback(candidateId)
      .then((record) => {
        if (!cancelled && record) setFeedbackVerdict(record.latest_verdict);
      })
      .catch(() => {
        /* feedback is optional context — never block the panel on it */
      });
    return () => {
      cancelled = true;
    };
  }, [candidateId]);

  const onFeedback = (verdict: FeedbackVerdict) => {
    if (!candidateId || feedbackBusy) return;
    setFeedbackBusy(true);
    void sendCandidateFeedback({
      candidate_id: candidateId,
      candidate_name: profile?.name ?? undefined,
      verdict,
    })
      .then((record) => setFeedbackVerdict(record.latest_verdict))
      .finally(() => setFeedbackBusy(false));
  };

  useEffect(() => {
    const username = profile?.github?.username;
    if (!username) {
      setCandidateId(null);
      setAssessment(null);
      return;
    }
    let cancelled = false;
    setAssessmentLoading(true);
    void fetchCandidates()
      .then((data) => {
        const candidate = data.candidates.find(
          (item) => item.github_username?.toLowerCase() === username.toLowerCase()
        );
        if (!candidate) {
          if (!cancelled) {
            setCandidateId(null);
            setAssessment(null);
          }
          return;
        }
        if (!cancelled) setCandidateId(candidate.candidate_id);
        return fetchLatestCandidateAssessment(candidate.candidate_id)
          .then((result) => {
            if (!cancelled) setAssessment(result.assessment);
          })
          .catch(() => {
            if (!cancelled) setAssessment(null);
          });
      })
      .catch(() => {
        if (!cancelled) {
          setCandidateId(null);
          setAssessment(null);
        }
      })
      .finally(() => {
        if (!cancelled) setAssessmentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profile?.github?.username]);
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
  const pageUrlOptions = previewablePageUrls({
    website: websiteUrl,
    blog: blogUrl,
  });
  const graphPageUrl = pageUrlOptions[0]?.url || websiteUrl || blogUrl;
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
    (node?.relation === "collaborator" || node?.relation === "follower") &&
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
            {profile.relation === "website" ? "same site" : profile.relation}
            {typeof profile.hop === "number" && profile.hop > 0
              ? ` · hop ${profile.hop}`
              : ""}
            {profile.relation !== "seed" &&
              profile.relation !== "website" &&
              ` · context ${profile.context_score}`}
          </p>
          <h2>
            {profile.name}
            {(profile.age_label ?? node?.age_label) ? (
              <span className="name-age">
                {" "}
                · {profile.age_label ?? node?.age_label}
              </span>
            ) : null}
            {markId && (
              <button
                type="button"
                className={`mark-star ${marked ? "on" : ""}`}
                title="Mark to look at later — does not enqueue LinkedIn"
                disabled={markBusy}
                onClick={() => {
                  if (!markId || markBusy) return;
                  setMarkBusy(true);
                  const op = marked
                    ? deleteMark(markId)
                    : putMark({
                        id: markId,
                        name: profile.name,
                        source: "graph",
                        seed_slug: seedSlug ?? profile.seed,
                        candidate_id: candidateId ?? undefined,
                        person_slug: profile.slug,
                      });
                  void op
                    .then(() => setMarked(!marked))
                    .catch((err) =>
                      onError?.(
                        err instanceof Error ? err.message : String(err)
                      )
                    )
                    .finally(() => setMarkBusy(false));
                }}
              >
                ★
              </button>
            )}
          </h2>

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

          {(node?.bridge_seed_count ?? 0) >= 2 && (
            <p className="bridge-callout">
              🔗 Network bridge — connected to {node!.bridge_seed_count} seed-set
              members: {node!.bridge_seeds?.join(", ")}
            </p>
          )}

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

          {!canExpand &&
            hop === 1 &&
            node?.relation !== "seed" &&
            node?.relation !== "website" && (
            <p className="muted" style={{ marginTop: "0.5rem" }}>
              No LinkedIn on this GitHub profile — branch expand unavailable.
            </p>
          )}
          {node?.relation === "website" && (
            <p className="muted" style={{ marginTop: "0.5rem" }}>
              Same-site neighbor. GitHub is profile-only — no collab expand.
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

          {graphPageUrl && seedSlug && onWebsiteRun && (
            <section>
              <h3>People on this site</h3>
              <p className="muted">
                Preview names, then confirm LinkedIn resolve (org token required
                unless the page already has a LinkedIn URL). Star only saves a
                reminder.
              </p>
              {!siteOpen ? (
                <button
                  type="button"
                  className="expand-btn"
                  onClick={() => setSiteOpen(true)}
                >
                  People on this site
                </button>
              ) : (
                <WebsiteGraphPanel
                  seedSlug={seedSlug}
                  hostSlug={
                    node && node.hop !== 0
                      ? node.id.includes(":")
                        ? node.id.slice(node.id.indexOf(":") + 1)
                        : node.id
                      : undefined
                  }
                  defaultUrl={graphPageUrl}
                  urlOptions={pageUrlOptions}
                  defaultOrgHint={profile.linkedin?.college || undefined}
                  running={expanding || pipelineRunning}
                  compact
                  onStartRun={onWebsiteRun}
                  onError={onError ?? (() => {})}
                />
              )}
            </section>
          )}

          <section className="profile-assessment">
            <h3>Assessment</h3>
            {candidateId && (
              <div className="feedback-row" aria-label="Reviewer feedback">
                {(
                  [
                    ["relevant", "👍 Relevant"],
                    ["not_relevant", "👎 Not relevant"],
                    ["explore_network", "🕸 Explore network"],
                  ] as [FeedbackVerdict, string][]
                ).map(([verdict, label]) => (
                  <button
                    key={verdict}
                    type="button"
                    className={`feedback-btn ${feedbackVerdict === verdict ? "active" : ""}`}
                    disabled={feedbackBusy}
                    onClick={() => onFeedback(verdict)}
                    title="Feeds future digest ranking (not_relevant hides; relevant boosts)"
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {assessmentLoading && <p className="muted">Loading assessment…</p>}
            {!assessmentLoading && !assessment && (
              <>
                <p className="muted">No assessment recorded for this candidate.</p>
                {candidateId && onAssessCandidate && (
                  <button type="button" className="expand-btn" onClick={() => onAssessCandidate(candidateId)}>
                    Assess candidate
                  </button>
                )}
              </>
            )}
            {assessment && (
              <AssessmentResultView
                assessment={assessment}
                runId={assessment.assessment_run_id}
                onRetry={
                  candidateId && onAssessCandidate
                    ? () => onAssessCandidate(candidateId)
                    : undefined
                }
              />
            )}
          </section>
        </div>
      )}
    </aside>
  );
}

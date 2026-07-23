# GitHub Signal Specification

## Scope

This specification covers the exact GitHub collection layer requested in the July 2026 technical review.[file:43][web:48][web:13]

## Authentication

- Prefer a fine-grained personal access token or GitHub App installation token for all production calls.[web:48]
- Public data may be readable without auth on some endpoints, but authenticated use is required for stable quotas and code search.[web:48]
- Required scopes vary by token type; use the minimum read-only repository metadata scopes available under current GitHub guidance.[web:48]

## Signal table

| Signal | REST endpoint | GraphQL query/field | Authentication | Required scopes | Pagination | Rate-limit cost | Fields used | Candidate-linking method | Cache key | Requests per candidate | Failure modes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Candidate repositories | `GET /users/{login}/repos?type=owner&sort=updated&per_page=100` | `user(login:$login){repositories(first:100,ownerAffiliations:OWNER,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{nameWithOwner isFork isTemplate createdAt pushedAt url}}}` | Yes preferred | read metadata | cursor/page | standard REST / GraphQL cost model | repo name owner fork template createdAt pushedAt defaultBranchRef | exact login or stitched login | `gh:user:{login}:repos` | 1-3 | renamed account, private repos unavailable |
| Repository metadata | `GET /repos/{owner}/{repo}` | `repository(owner:$owner,name:$repo){id nameWithOwner description createdAt pushedAt defaultBranchRef{ name } isFork isTemplate licenseInfo{spdxId} stargazerCount forkCount watchers{totalCount}}` | Yes preferred | read metadata | none | low | fork/template/default branch/license/topics/dates | repo linked to candidate repo set | `gh:repo:{owner}/{repo}:meta` | 1 | deleted/renamed repos |
| Fork relationships | `GET /repos/{owner}/{repo}` and `GET /repos/{owner}/{repo}/forks` | `repository{isFork parent{nameWithOwner}}` | Yes preferred | read metadata | page/cursor | low-medium | isFork parent fork list | repo-level | `gh:repo:{owner}/{repo}:forks` | 1-5 | large fork trees |
| Template relationships | `GET /repos/{owner}/{repo}` | `repository{isTemplate}` | Yes preferred | read metadata | none | low | isTemplate | repo-level | `gh:repo:{owner}/{repo}:template` | 1 | missing historical template provenance |
| Default branch | `GET /repos/{owner}/{repo}` | `repository{defaultBranchRef{name target{oid}}}` | Yes preferred | read metadata | none | low | branch name SHA | repo-level | `gh:repo:{owner}/{repo}:defaultbranch` | 1 | detached or empty repo |
| Recursive tree | `GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1` | `repository{object(expression:$expr){... on Tree{entries{name type path oid}}}}` | Yes preferred | contents metadata | none | medium | path type sha | repo-level | `gh:repo:{owner}/{repo}:tree:{sha}` | 1 | tree truncation, giant repos |
| Languages | `GET /repos/{owner}/{repo}/languages` | `repository{languages(first:20,orderBy:{field:SIZE,direction:DESC}){edges{size node{name}}}}` | Yes preferred | read metadata | none | low | language byte sizes | repo-level | `gh:repo:{owner}/{repo}:languages` | 1 | vendored/generated code skew |
| Topics | `GET /repos/{owner}/{repo}/topics` | `repository{repositoryTopics(first:50){nodes{topic{name}}}}` | Yes preferred | metadata | cursor/page | low | topics | repo-level | `gh:repo:{owner}/{repo}:topics` | 1 | missing topics |
| Contributors | `GET /repos/{owner}/{repo}/contributors?per_page=100&anon=1` | no exact contributor aggregate; infer from commit history or collaborators if accessible | Yes preferred | metadata | page | medium | login contributions count | stitched identity | `gh:repo:{owner}/{repo}:contributors` | 1-5 | anonymous commits, bots, missing emails |
| Candidate commits | `GET /repos/{owner}/{repo}/commits?author={login}&per_page=100` | `repository{defaultBranchRef{target{... on Commit{history(first:100,author:{id:$authorId}){nodes{oid authoredDate additions deletions changedFilesIfAvailable author{user{login} email name}}}}}}}` | Yes | metadata | page/cursor | medium-high | sha date author additions deletions changedFiles | login plus email/name stitching | `gh:repo:{owner}/{repo}:commits:{candidate}` | 1-20 | squash merges, rebases, missing author user |
| Commit changed files | `GET /repos/{owner}/{repo}/commits/{sha}` | commit object fields where available | Yes | metadata | none | medium | files filename status additions deletions patch | commit linked to candidate | `gh:repo:{owner}/{repo}:commit:{sha}` | per sampled commit | file lists truncated on huge commits |
| Pull requests authored | `GET /repos/{owner}/{repo}/pulls?state=all&per_page=100` then filter user | `repository{pullRequests(first:100,states:[OPEN,MERGED,CLOSED],orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number author{login} createdAt mergedAt changedFiles additions deletions reviewDecision}}}` | Yes | metadata | page/cursor | medium | author state mergedAt changedFiles | author login exact/stitch | `gh:repo:{owner}/{repo}:prs` | 1-10 | very large PR sets |
| Pull requests merged | same as above | same as above with `mergedAt` | Yes | metadata | page/cursor | medium | mergedAt mergeCommit | author login | `gh:repo:{owner}/{repo}:mergedprs` | included above | merge done by maintainer not author |
| Pull-request changed files | `GET /repos/{owner}/{repo}/pulls/{number}/files?per_page=100` | `pullRequest(number:$n){files(first:100){nodes{path additions deletions changeType}}}` | Yes | metadata | page/cursor | medium | file path diff stats | PR author linked | `gh:repo:{owner}/{repo}:pr:{n}:files` | per PR sampled | truncation on huge PRs |
| Pull-request commits | `GET /repos/{owner}/{repo}/pulls/{number}/commits` | `pullRequest(number:$n){commits(first:100){nodes{commit{oid authoredDate author{user{login} email name}}}}}` | Yes | metadata | page/cursor | medium | commit list | PR-linked | `gh:repo:{owner}/{repo}:pr:{n}:commits` | per PR sampled | rebases, squash merges |
| Pull-request reviews | `GET /repos/{owner}/{repo}/pulls/{number}/reviews` | `pullRequest(number:$n){reviews(first:100){nodes{author{login} state createdAt submittedAt body}}}` | Yes | metadata | page/cursor | medium | reviewer login state dates | reviewer login exact/stitch | `gh:repo:{owner}/{repo}:pr:{n}:reviews` | per PR sampled | deleted users |
| Review comments | `GET /repos/{owner}/{repo}/pulls/{number}/comments` | `pullRequest(number:$n){reviewThreads(first:100){nodes{comments(first:100){nodes{author{login} path createdAt body}}}}}` | Yes | metadata | page/cursor | medium-high | path author date | reviewer/comment author login | `gh:repo:{owner}/{repo}:pr:{n}:comments` | per PR sampled | large threads |
| Issues opened | `GET /repos/{owner}/{repo}/issues?state=all&creator={login}` | `repository{issues(first:100,states:[OPEN,CLOSED],filterBy:{createdBy:$login}){nodes{number state createdAt closedAt author{login}}}}` | Yes | metadata | page/cursor | medium | author state dates | login/stitch | `gh:repo:{owner}/{repo}:issuesopened:{candidate}` | 1-5 | issue/PR overlap |
| Issues closed | timeline/event endpoints if needed | GraphQL timeline items | Yes | metadata | page/cursor | medium-high | closer dates actor | login/stitch | `gh:repo:{owner}/{repo}:issuesclosed:{candidate}` | 1-10 | closer not explicit on all objects |
| Reviews performed by candidate | search across reviews collected above | `repository{pullRequests(...){nodes{reviews(first:100){nodes{author{login}}}}}}` | Yes | metadata | page/cursor | medium | review author state | exact/stitch | `gh:repo:{owner}/{repo}:reviewsby:{candidate}` | included | sparse in some repos |
| Releases | `GET /repos/{owner}/{repo}/releases` | `repository{releases(first:50,orderBy:{field:CREATED_AT,direction:DESC}){nodes{name tagName createdAt isDraft isPrerelease}}}` | Yes | metadata | page/cursor | low-medium | tag release dates author | release author/stitch | `gh:repo:{owner}/{repo}:releases` | 1-3 | missing release author |
| Tags | `GET /repos/{owner}/{repo}/tags` | `repository{refs(refPrefix:"refs/tags/",first:100){nodes{name target{oid}}}}` | Yes | metadata | page/cursor | low-medium | tag name sha | repo-level | `gh:repo:{owner}/{repo}:tags` | 1-5 | annotated tags complexity |
| Workflow files | tree lookup under `.github/workflows/` | tree/object query | Yes | contents metadata | none | medium | workflow paths | repo-level | `gh:repo:{owner}/{repo}:workflows` | 1 | empty/alt CI systems |
| Workflow runs | `GET /repos/{owner}/{repo}/actions/runs` | no exact complete GraphQL equivalent preferred | Yes | actions read | page | medium | status conclusion event branch actor | actor/stitch | `gh:repo:{owner}/{repo}:workflowruns` | 1-10 | retention limits |
| Deployment records | `GET /repos/{owner}/{repo}/deployments` | limited GraphQL support; use REST | Yes | deployments read | page | medium | environment creator created_at statuses_url | creator/stitch | `gh:repo:{owner}/{repo}:deployments` | 1-10 | many repos have none |
| CODEOWNERS | contents/tree/raw file retrieval | `repository{object(expression:"HEAD:CODEOWNERS"){... on Blob{text}}}` and common alt paths | Yes | contents read | none | low | CODEOWNERS text | username/email in file | `gh:repo:{owner}/{repo}:codeowners:{sha}` | 1-4 | nonstandard path |
| External repository contributions | search candidate PRs/issues across non-owned repos | `user(login:$login){repositoriesContributedTo(first:100,contributionTypes:[COMMIT,ISSUE,PULL_REQUEST,REPOSITORY]){nodes{nameWithOwner owner{login}}}}` | Yes | metadata | cursor | medium | repo list contribution type | exact login | `gh:user:{login}:externalcontribs` | 1-5 | incomplete history windows |
| Repeat external contributions | derived from repeated external repo events | same as above plus PR history | Yes | metadata | derived | derived | repeated repos over time | exact login | derived | derived | identity gaps |
| Package/dependency usage | ecosystem-specific package registries plus repo manifests | repo files via GraphQL tree/blob | Yes | contents read | varies | medium | package names manifest refs | repo linked | `gh:repo:{owner}/{repo}:deps` | 1-10 | private registries, language variance |
| Downstream dependents | repo network pages or package ecosystem APIs where public | limited GraphQL; often external | Yes preferred | metadata | varies | varies | dependents counts/links | package name linkage | `pkg:{ecosystem}:{name}:dependents` | varies | unavailable for many ecosystems |
| Release downloads | `GET /repos/{owner}/{repo}/releases` assets fields | `repository{releases(first:50){nodes{releaseAssets(first:100){nodes{downloadCount name}}}}}` | Yes | metadata | cursor | medium | asset download counts | release-linked | `gh:repo:{owner}/{repo}:releasedownloads` | 1-5 | not present for package-manager installs |
| Repository creation/activity dates | `GET /repos/{owner}/{repo}` | `repository{createdAt pushedAt updatedAt archivedAt}` | Yes preferred | metadata | none | low | dates | repo-level | `gh:repo:{owner}/{repo}:dates` | 1 | mirror/import histories |

## Example REST URLs

- `https://api.github.com/users/{login}/repos?type=owner&sort=updated&per_page=100`[web:48]
- `https://api.github.com/repos/{owner}/{repo}`[web:48]
- `https://api.github.com/repos/{owner}/{repo}/git/trees/{sha}?recursive=1`[web:48]
- `https://api.github.com/repos/{owner}/{repo}/pulls/{number}/files?per_page=100`[web:48]
- `https://api.github.com/repos/{owner}/{repo}/actions/runs?per_page=100`[web:48]

## Notes

- Use REST for endpoints with stronger object-specific support such as actions, deployments, or explicit file lists.[web:48]
- Use GraphQL for repository-centered evidence packages that need nested retrieval and fewer round trips.[web:13]
- Do not use stars, forks, or followers as direct talent scores.[file:1][file:43]

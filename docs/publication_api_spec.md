# Publication API Specification

## Purpose

This specification covers OpenAlex, Crossref, ORCID, Semantic Scholar, DataCite, Unpaywall, OpenCitations, PubMed/Europe PMC, and JATS XML at an implementation level.[file:43][cite:12][cite:17][web:71][web:63]

## API table

| Service | Purpose | Endpoint example | Auth | Rate limit | Pagination | Useful fields | Identity value | Full-text value | Contribution-role value | License constraints | Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| OpenAlex | Work/author/source lookup | `https://api.openalex.org/works?filter=doi:10.1145/3387111` | Optional API key | See current docs; header-aware | page and cursor | ids, doi, title, authorships, cited_by_count, open_access, locations, primary_location, grants, concepts | high | medium | low | based on linked sources | usage-based / documented pricing as of 2026 [cite:12] |
| Crossref | DOI metadata | `https://api.crossref.org/works/10.1145/3387111` | No for public reads | service-politeness guidance | cursor / rows depending endpoint | DOI, title, author, published, relation, funder, license, references | medium | low | medium where deposited | depositor/publisher dependent | public metadata API [cite:17] |
| ORCID Public API | Person identity | `https://pub.orcid.org/v3.0/{orcid}/record` | Public API credentials recommended | see ORCID docs | record-oriented | person, activities-summary, works links, websites | very high | low | low-medium | public-record constrained | public access tier [web:71] |
| Semantic Scholar | citation/context enrichment | official graph endpoints | API key often required | per service docs | token/page | paperId, citations, references, influentialCitationCount, fieldsOfStudy | medium | low | low | depends on service terms | free tier limits vary |
| DataCite | DOI metadata esp. datasets/software | `https://api.datacite.org/dois/{doi}` | Public read | see docs | page | creators, contributors, types, relatedIdentifiers, rights, urls | medium | low | medium | repository-dependent | public metadata; avoid deprecated legacy endpoints [web:61][web:63] |
| Unpaywall | OA status | `https://api.unpaywall.org/v2/{doi}?email=you@example.com` | email parameter | per service docs | none | is_oa, oa_status, best_oa_location | low | high for OA links | none | OA availability rules | free with attribution |
| OpenCitations | citation graph | official citation endpoints | generally public | service docs | page-like patterns | citing, cited, citation links | low | low | none | open citation subset only | free/open |
| PubMed | biomedical metadata | E-utilities requests | usually no auth | NCBI usage guidance | retstart/retmax | PMID, title, abstract, publication types | medium | low | low | biomedical scope | free |
| Europe PMC | full text and grants where relevant | search/article endpoints | public | service docs | cursor/page | pmcid, abstract, full text links, grants | medium | medium-high | low | biomedical scope | free |
| Publisher JATS XML | structured full text | publisher/article XML URLs where allowed | varies | varies | none | contrib-group, fn, funding, sec, fig, table-wrap, ext-link | medium | very high | high if contribution statements included | publisher license/robots constraints | variable |

## Authority map

- DOI: Crossref first, DataCite second for DataCite-registered objects.[cite:17][web:61]
- ORCID: ORCID authoritative.[web:71]
- Author identity: ORCID first; OpenAlex supporting disambiguation.[cite:12][web:71]
- Open-access status: Unpaywall first; OpenAlex as supporting field.[cite:12]
- Citation context: OpenCitations, Semantic Scholar, OpenAlex cited-by aggregates.[cite:12]
- Retractions/updates: publisher metadata, Crossref relations, PubMed/Europe PMC where available.[cite:17]
- CRediT contributions: JATS or Crossref when deposited; otherwise unavailable.[cite:22][cite:17]
- Full text: JATS or OA landing/full-text providers where licensed.
- Data/software links: Crossref relations, DataCite relatedIdentifiers, OpenAlex locations and ids.[cite:12][web:61]

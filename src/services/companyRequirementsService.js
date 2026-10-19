const CompanyModel = require("../models/companyModel");
const CompanyJobSearchService = require("./companyJobSearchService");
const JobPostingExtractorService = require("./jobPostingExtractorService");
const CompanyArchiveRequirementsService = require("./companyArchiveRequirementsService");

/**
 * Company Requirements Service
 * Orchestrates live search discovery, safe extraction, verified LinkedIn archives,
 * and database persistence.
 */
class CompanyRequirementsService {
  /**
   * Search and retrieve verified job requirements for a company and role
   */
  static async getOrSearchRequirements({ company, jobRole, seniority = "Intermediate", location = "" }) {
    if (!company || !company.trim()) {
      return {
        success: false,
        isVerified: false,
        message: "Target company name is required.",
        requirements: [],
      };
    }

    const cleanCompany = company.trim();
    const cleanRole = (jobRole || "Software Engineer").trim();

    // 1. Ensure company record exists in DB
    const companyRecord = await CompanyModel.findOrCreateCompany(cleanCompany);

    // 2. Check if already stored and verified recently in DB (Cache Check)
    const existingPosting = await CompanyModel.findRecentPosting(companyRecord.id, cleanRole);
    if (existingPosting) {
      const details = await CompanyModel.getPostingDetails(existingPosting.id);
      if (details && details.requirements && details.requirements.length > 0) {
        await CompanyModel.touchJobPosting(existingPosting.id);
        return {
          success: true,
          isVerified: true,
          isCached: true,
          company: cleanCompany,
          jobPostingId: details.id,
          jobTitle: details.job_title,
          sourceUrl: details.source_url,
          sourceType: details.source_type,
          location: details.location,
          seniorityLevel: details.seniority_level,
          lastVerifiedAt: details.last_verified_at,
          requirements: details.requirements,
          message: `Retrieved ${details.requirements.length} verified hiring requirements for ${cleanCompany} (${details.source_type === "linkedin_archive" ? "LinkedIn Archive" : "Careers Portal"}).`,
        };
      }
    }

    // 3. Attempt live search discovery across official careers and public posts
    let verifiedPosting = null;
    let liveSearchResults = [];

    try {
      liveSearchResults = await CompanyJobSearchService.searchJobPostings({
        company: cleanCompany,
        jobRole: cleanRole,
        seniority,
        location,
      });
    } catch (searchErr) {
      console.warn("Live web search notice:", searchErr.message);
    }

    if (liveSearchResults && liveSearchResults.length > 0) {
      for (const result of liveSearchResults) {
        try {
          if (!JobPostingExtractorService.isSafeUrl(result.url)) continue;

          // Fetch job page HTML and extract clean text
          const rawJobText = await JobPostingExtractorService.fetchJobHtml(result.url);
          if (!rawJobText || rawJobText.length < 250) continue;

          const contentHash = JobPostingExtractorService.computeContentHash(rawJobText);

          // Check if already stored in DB
          const duplicate = await CompanyModel.findJobPostingByHash(contentHash);
          if (duplicate) {
            await CompanyModel.touchJobPosting(duplicate.id);
            verifiedPosting = await CompanyModel.getPostingDetails(duplicate.id);
            break;
          }

          // Extract structured requirements with AI (bounded to 5s timeout)
          const aiExtraction = await Promise.race([
            JobPostingExtractorService.extractRequirementsWithAI({
              rawJobText,
              companyName: cleanCompany,
              targetJobRole: cleanRole,
              sourceUrl: result.url,
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("AI extraction timeout")), 5000)),
          ]).catch(() => null);

          if (aiExtraction && Array.isArray(aiExtraction.requirements) && aiExtraction.requirements.length > 0) {
            const postingId = await CompanyModel.createJobPosting({
              companyId: companyRecord.id,
              jobTitle: aiExtraction.job_title || cleanRole,
              location: aiExtraction.location || location || "Any / Remote",
              seniorityLevel: aiExtraction.seniority_level || seniority,
              sourceUrl: result.url,
              sourceType: result.sourceType || "careers_page",
              rawJobDescription: rawJobText.slice(0, 15000),
              contentHash,
              status: "verified",
            });

            await CompanyModel.saveJobRequirements(postingId, aiExtraction.requirements);
            verifiedPosting = await CompanyModel.getPostingDetails(postingId);

            await CompanyModel.logSearch({
              companyName: cleanCompany,
              jobRole: cleanRole,
              seniorityLevel: seniority,
              location,
              searchStatus: "success",
              resultsCount: aiExtraction.requirements.length,
            });

            break;
          }
        } catch (extractErr) {
          // Continue to next result or archive fallback
        }
      }
    }

    // 4. Archive Fallback: Pull from verified LinkedIn & public job specifications
    if (!verifiedPosting) {
      const archiveProfile = CompanyArchiveRequirementsService.findArchivedRequirementProfile(
        cleanCompany,
        cleanRole
      );

      if (archiveProfile && archiveProfile.requirements && archiveProfile.requirements.length > 0) {
        const contentHash = CompanyArchiveRequirementsService.computeContentHash(
          archiveProfile.rawJobDescription
        );

        let postingId = null;
        const existingHashPosting = await CompanyModel.findJobPostingByHash(contentHash);

        if (existingHashPosting) {
          postingId = existingHashPosting.id;
          await CompanyModel.touchJobPosting(postingId);
        } else {
          postingId = await CompanyModel.createJobPosting({
            companyId: companyRecord.id,
            jobTitle: archiveProfile.jobTitle,
            location: location || "Sri Lanka / Hybrid",
            seniorityLevel: seniority,
            sourceUrl: archiveProfile.sourceUrl,
            sourceType: archiveProfile.sourceType || "linkedin_archive",
            rawJobDescription: archiveProfile.rawJobDescription,
            contentHash,
            status: "verified",
          });
        }

        await CompanyModel.saveJobRequirements(postingId, archiveProfile.requirements);
        verifiedPosting = await CompanyModel.getPostingDetails(postingId);

        // Update company official careers url if available
        if (archiveProfile.officialCareersUrl && !companyRecord.official_careers_url) {
          await CompanyModel.findOrCreateCompany(cleanCompany, archiveProfile.officialCareersUrl);
        }

        // Log search success
        await CompanyModel.logSearch({
          companyName: cleanCompany,
          jobRole: cleanRole,
          seniorityLevel: seniority,
          location,
          searchStatus: "success",
          resultsCount: archiveProfile.requirements.length,
        });
      }
    }

    // 5. Final Result
    if (verifiedPosting) {
      return {
        success: true,
        isVerified: true,
        isCached: !!verifiedPosting.is_cached,
        company: cleanCompany,
        jobPostingId: verifiedPosting.id,
        jobTitle: verifiedPosting.job_title,
        sourceUrl: verifiedPosting.source_url,
        sourceType: verifiedPosting.source_type,
        location: verifiedPosting.location,
        seniorityLevel: verifiedPosting.seniority_level,
        lastVerifiedAt: verifiedPosting.last_verified_at,
        requirements: verifiedPosting.requirements || [],
        message: `Verified ${verifiedPosting.requirements ? verifiedPosting.requirements.length : 0} real hiring requirements for ${cleanCompany} from LinkedIn & Career Archives!`,
      };
    }

    // 6. Fallback logging if everything failed
    await CompanyModel.logSearch({
      companyName: cleanCompany,
      jobRole: cleanRole,
      seniorityLevel: seniority,
      location,
      searchStatus: "not_found",
      resultsCount: 0,
    });

    return {
      success: true,
      isVerified: false,
      message: `No job specifications found for ${cleanCompany}. Standard competency will be evaluated.`,
      company: cleanCompany,
      jobPostingId: null,
      requirements: [],
    };
  }
}

module.exports = CompanyRequirementsService;

const {writeFileSync, mkdirSync, existsSync} = require("fs");
const {Client} = require("@notionhq/client");
const core = require("@actions/core");
const github = require("@actions/github");

async function run() {
    try {
        const notion = new Client({
            auth: core.getInput("NOTION_TOKEN"),
        });

        const retrievePageProperties = async (pageId) => {
            return await notion.pages.retrieve({page_id: pageId});
        };

        const retrievePageBlocks = async (pageId) => {
            const block = await notion.blocks.children.list({block_id: pageId});
            for (const obj of block.results) {
                if (obj.has_children) {
                    obj.children = await retrievePageBlocks(obj.id);
                }
            }
            return block;
        };

        const databaseId = core.getInput("NOTION_DATABASE_ID");
        const pages = await notion.databases.query({database_id: databaseId});

        const contentDir = "./content";
        if (!existsSync(contentDir)) {
            mkdirSync(contentDir);
        }

        const pagePromises = pages.results.map(async (page) => {
            // retrieve edited pages
            // get pages which have been edited in the last 24 hours
            const editedTime = new Date(page.last_edited_time);
            const currentTime = new Date();
            const timeDiff = currentTime - editedTime;
            const timeDiffInHours = timeDiff / (1000 * 3600);
            if (timeDiffInHours > 24) {
                return {fileName: "", pageProperties: {}}; // return empty object
            }

            const pageProperties = await retrievePageProperties(page.id);
            pageProperties.blocks = await retrievePageBlocks(page.id);
            const fileName = `${page.id}.json`;
            writeFileSync(fileName, JSON.stringify(pageProperties, null, 2));
            core.info(`Wrote ${fileName}`);
            return {fileName, pageProperties};
        });

        // Wait for all pages to be processed and files to be written
        const results = await Promise.all(pagePromises);

        // Commit all files to GitHub
        const token = core.getInput("GITHUB_TOKEN");
        const octokit = github.getOctokit(token);

        const commitMessage = "Update Notion database";

        if(results.filter((result) => result.fileName !== "").length === 0) {
            core.info("No pages were updated, skipping commit");
            return;
        }

        await octokit.rest.git.createTree({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            base_tree: github.context.sha,
            tree: results.filter((result) => result.fileName !== "")
                .map((result) => ({
                path: "content/"+encodeURIComponent(result.fileName),
                mode: "100644",
                type: "blob",
                content: JSON.stringify(result.pageProperties),
            })),
        }).then(async (tree) => {
            await octokit.rest.git.createCommit({
                owner: github.context.repo.owner,
                repo: github.context.repo.repo,
                message: commitMessage,
                tree: tree.data.sha,
                parents: [github.context.sha],
            }).then(async (commit) => {
                await octokit.rest.git.updateRef({
                    owner: github.context.repo.owner,
                    repo: github.context.repo.repo,
                    ref: `heads/${core.getInput("COMMIT_BRANCH")}`,
                    sha: commit.data.sha,
                });
            });
        });
    } catch (error) {
        core.setFailed(error);
    }
}

run();
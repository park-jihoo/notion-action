const {writeFileSync} = require("fs");
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

        const pagePromises = pages.results.map(async (page) => {
            const pageProperties = await retrievePageProperties(page.id);
            pageProperties.blocks = await retrievePageBlocks(page.id);
            const fileName = `content/${page.id}.json`;
            writeFileSync(fileName, JSON.stringify(pageProperties, null, 2));
            core.info(`Wrote ${fileName.split("/")[1]}`);
            return {fileName, pageProperties};
        });

        // Wait for all pages to be processed and files to be written
        const results = await Promise.all(pagePromises);

        // Commit all files to GitHub
        const token = core.getInput("GITHUB_TOKEN");
        const octokit = github.getOctokit(token);

        const commitMessage = "Update Notion database";

        await octokit.git.createTree({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            base_tree: github.context.sha,
            tree: results.map((result) => ({
                path: result.fileName,
                mode: "100644",
                type: "blob",
                content: JSON.stringify(result.pageProperties),
            })),
        }).then(async (tree) => {
            await octokit.git.createCommit({
                owner: github.context.repo.owner,
                repo: github.context.repo.repo,
                message: commitMessage,
                tree: tree.data.sha,
                parents: [github.context.sha],
            }).then(async (commit) => {
                await octokit.git.updateRef({
                    owner: github.context.repo.owner,
                    repo: github.context.repo.repo,
                    ref: "heads/master",
                    sha: commit.data.sha,
                });
            });
        });
    } catch (error) {
        core.setFailed(error);
    }
}

run();
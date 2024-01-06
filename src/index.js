const { writeFileSync } = require("fs");
const { Client } = require("@notionhq/client");
const core = require("@actions/core");
const github = require("@actions/github");

async function run() {
    try {
        const notion = new Client({
            auth: core.getInput("NOTION_TOKEN"),
        });

        const retrievePageProperties = async (pageId) => {
            return await notion.pages.retrieve({ page_id: pageId });
        };

        const retrievePageBlocks = async (pageId) => {
            const block = await notion.blocks.children.list({ block_id: pageId });
            for (const obj of block.results) {
                if (obj.has_children) {
                    obj.children = await retrievePageBlocks(obj.id);
                }
            }
            return block;
        };

        const databaseId = core.getInput("NOTION_DATABASE_ID");
        const pages = await notion.databases.query({ database_id: databaseId });

        for (const page of pages.results) {
            const pageProperties = await retrievePageProperties(page.id);
            pageProperties.blocks = await retrievePageBlocks(page.id);

            const fileName = `notion_${page.id}.json`;
            writeFileSync(fileName, JSON.stringify(pageProperties, null, 2));

            // Commit and push for each file
            const myToken = core.getInput("GITHUB_TOKEN");
            const { owner, repo } = github.context.repo;
            const { sha } = github.context;
            const file = fileName;
            const content = Buffer.from(JSON.stringify(pageProperties, null, 2)).toString("base64");
            const message = `Update ${fileName}`;
            const branch = core.getInput("COMMIT_BRANCH");
            const octokit = github.getOctokit(myToken);

            const response = await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: file,
                message,
                content,
                sha,
                branch,
            });
        }
    } catch (error) {
        core.setFailed(error.message);
    }
}

run();
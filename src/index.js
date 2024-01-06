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

        const pagePromises = pages.results.map(async (page) => {
            const pageProperties = await retrievePageProperties(page.id);
            pageProperties.blocks = await retrievePageBlocks(page.id);
            const fileName = `notion_${page.id}.json`;
            writeFileSync(fileName, JSON.stringify(pageProperties, null, 2));
            return { fileName, pageProperties };
        });

        // Wait for all pages to be processed and files to be written
        const results = await Promise.all(pagePromises);

        // Commit and push for each file
        const myToken = core.getInput("GITHUB_TOKEN");
        const { owner, repo } = github.context.repo;
        const branch = core.getInput("COMMIT_BRANCH");
        const octokit = github.getOctokit(myToken);

        const commitPromises = results.map(async ({ fileName, pageProperties }) => {
            const file = fileName;
            const content = Buffer.from(JSON.stringify(pageProperties, null, 2)).toString("base64");
            const message = `Update ${fileName}`;

            const response = await octokit.repos.getContent({
                owner: owner,
                repo: repo,
                path: file,
                ref: branch,
            });

            // Update file if it already exists
            if (response.status === 200) {
                return octokit.repos.createOrUpdateFileContents({
                    owner: owner,
                    repo: repo,
                    path: file,
                    message: message,
                    content: content,
                    branch: branch,
                    sha: response.data.sha,
                    committer: {
                        name: "GitHub Actions",
                        email: "github-actions[bot]@users.noreply.github.com"
                    },
                    author: {
                        name: "GitHub Actions",
                        email: "github-actions[bot]@users.noreply.github.com"
                    },
                });
            }

            // Create file if it does not exist
            return octokit.repos.createOrUpdateFileContents({
                owner: owner,
                repo: repo,
                path: file,
                message: message,
                content: content,
                branch: branch,
                committer: {
                    name: "GitHub Actions",
                    email: "github-actions[bot]@users.noreply.github.com"
                },
                author: {
                    name: "GitHub Actions",
                    email: "github-actions[bot]@users.noreply.github.com"
                },
            });
        });

        // Wait for all commits to be completed
        await Promise.all(commitPromises);
    } catch (error) {
        core.setFailed(error.message);
    }
}

run();
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

        const pagePromises = pages.results.slice(0, 1).map(async (page) => {
            const pageProperties = await retrievePageProperties(page.id);
            pageProperties.blocks = await retrievePageBlocks(page.id);
            const fileName = `notion_${page.id}.json`;
            writeFileSync(fileName, JSON.stringify(pageProperties, null, 2));
            core.info(`Wrote ${fileName}`);
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

            core.info(`Committing ${fileName} to ${owner}/${repo}@${branch}`);


            const response = await octokit.rest.repos.getContent({
                owner,
                repo,
                path: file
            }).then((response) => {
                if (response.status === 200) {
                    octokit.rest.repos.createOrUpdateFileContents({
                        owner,
                        repo,
                        path: file,
                        message,
                        content,
                        branch,
                        sha: response.data.sha,
                    });
                }

                core.info(`Response: ${response.status}`);
            }).catch((error) => {
                // create new file
                if (error.status === 404) {
                    core.info(`Error: ${error.status}`);
                    core.info(`Creating new file: ${file}`);
                    octokit.rest.repos.createOrUpdateFileContents({
                        owner,
                        repo,
                        path: file,
                        message,
                        content,
                        branch,
                    });
                }
            });
        });

        // Wait for all commits to be completed
        await Promise.all(commitPromises);
    } catch (error) {
        core.setFailed(error);
    }
}

run();
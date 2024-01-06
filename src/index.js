const {writeFileSync} = require("fs");
const {Client} = require("@notionhq/client");
const core = require("@actions/core");
const github = require("@actions/github");

const retrievePage = async (databaseId) => {
    return await notion.databases.query({database_id: databaseId});
}

const retrievePageProperties = async (pageId) => {
    return await notion.pages.retrieve({page_id: pageId});
}

const retrievePageBlocks = async (pageId) => {
    const block = await notion.blocks.children.list({ block_id: pageId });
    for (const obj of block.results) {
        if (obj.has_children) {
            obj.children = await retrievePageBlocks(obj.id);
        }
    }
    return block;
}

async function run() {
    try {
        const notion = new Client({
            auth: core.getInput("NOTION_TOKEN"),
        });
        const databaseId = core.getInput("NOTION_DATABASE_ID");
        const pages = await retrievePage(databaseId);
        let results = [];
        for (const page of pages.results) {
            console.log("page", page.title);
            const pageProperties = await retrievePageProperties(page.id);
            pageProperties.blocks = await retrievePageBlocks(page.id);
            results.push(pageProperties);
        }
        writeFileSync("notion.json", JSON.stringify(results, null, 2));
        core.setOutput("results", JSON.stringify(results, null, 2));
    } catch (error) {
        core.setFailed(error.message);
    }
}

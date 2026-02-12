require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId || !guildId) {
  console.error("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID or DISCORD_GUILD_ID in .env");
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName("watch")
    .setDescription("Watch a course section for open seats")
    .addStringOption(o => o.setName("term").setDescription("Term code, e.g. 202601").setRequired(true))
    .addStringOption(o => o.setName("course").setDescription("Course code, e.g. PSYCH 1XX3").setRequired(true))
    .addStringOption(o => o.setName("section").setDescription("Section label, e.g. C01").setRequired(true))
    .addStringOption(o => o.setName("va").setDescription("Optional VA").setRequired(false)),

  new SlashCommandBuilder()
    .setName("list")
    .setDescription("List your watches"),

  new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove a watch by ID")
    .addStringOption(o => o.setName("id").setDescription("Watch ID").setRequired(true)),

  new SlashCommandBuilder()
    .setName("notify")
    .setDescription("Set how I notify you")
    .addStringOption(o =>
      o.setName("mode")
        .setDescription("DM or channel")
        .setRequired(true)
        .addChoices(
          { name: "DM me", value: "dm" },
          { name: "Post in a channel", value: "channel" }
        ))
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription("Channel to post in (required if mode=channel)")
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName("settings")
    .setDescription("Show your notification settings"),

  new SlashCommandBuilder()
    .setName("checknow")
    .setDescription("Run poll immediately")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  try {
    console.log("Registering slash commands...");
    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands }
    );
    console.log("Done.");
  } catch (err) {
    console.error(err);
  }
})();

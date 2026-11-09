"""Offline fakes for the Discord bot tests.

Two fakes are provided:

* ``FakeDB`` — an in-memory stand-in for the Supabase (PostgREST) client used by
  ``bot/database.py``.  It implements the small chainable surface the bot uses
  (``select/insert/update/upsert/delete`` + ``eq/order/limit/execute``) and
  enforces the ``aliases``/``warnings`` -> ``users`` foreign keys so FK bugs
  actually fail the test suite instead of silently passing.
* ``FakeCtx`` and friends — the tiny piece of discord.py the command handlers
  touch (guild, channel, member, message, send/reply).
"""

import asyncio
import itertools

_next_message_id = itertools.count(1)


# --------------------------------------------------------------------------- DB


class _Resp:
    def __init__(self, data):
        self.data = data


def _matches(row, filters):
    return all(str(row.get(col)) == str(val) for col, val in filters)


class FakeDB:
    TABLES = (
        "guilds", "users", "aliases", "warnings", "war_settings", "wars",
        "race_state", "race_sheets", "race_logs", "maze_schedules",
        "player_ping_settings",
    )

    def __init__(self):
        self.tables = {}
        self.calls = []
        self.reset()

    def reset(self):
        self.tables = {name: [] for name in self.TABLES}
        self.calls = []

    def table(self, name):
        self.tables.setdefault(name, [])
        return _Query(self, name)

    # helpers for tests -----------------------------------------------------
    def rows(self, name):
        return self.tables.setdefault(name, [])

    def seed(self, name, *rows):
        self.rows(name).extend(dict(r) for r in rows)

    def one(self, table, **filters):
        for row in self.rows(table):
            if all(row.get(k) == v for k, v in filters.items()):
                return row
        return None

    def ops(self, name):
        return [op for (tbl, op, _payload) in self.calls if tbl == name]


class _Query:
    def __init__(self, db, name):
        self.db = db
        self.name = name
        self.op = "select"
        self.payload = None
        self.on_conflict = None
        self.ignore_duplicates = False
        self.filters = []
        self._order = None
        self._desc = False
        self._limit = None
        self.cols = "*"

    def select(self, cols="*"):
        self.op = "select"
        self.cols = cols
        return self

    def insert(self, payload):
        self.op = "insert"
        self.payload = dict(payload)
        return self

    def update(self, payload):
        self.op = "update"
        self.payload = dict(payload)
        return self

    def upsert(self, payload, on_conflict=None, ignore_duplicates=False):
        self.op = "upsert"
        self.payload = dict(payload)
        self.on_conflict = on_conflict
        self.ignore_duplicates = ignore_duplicates
        return self

    def delete(self):
        self.op = "delete"
        return self

    def eq(self, col, val):
        self.filters.append((col, val))
        return self

    def order(self, col, desc=False):
        self._order = col
        self._desc = desc
        return self

    def limit(self, n):
        self._limit = n
        return self

    # ------------------------------------------------------------------
    def _check_fk(self, row):
        fks = (
            ("aliases", "discord_id", "users", "discord_id"),
            ("warnings", "discord_id", "users", "discord_id"),
        )
        for table, col, parent, parent_col in fks:
            if self.name == table and row.get(col) is not None:
                known = any(
                    str(r.get(parent_col)) == str(row[col])
                    for r in self.db.rows(parent)
                )
                if not known:
                    raise RuntimeError(
                        f'FK violation: {table}.{col}={row[col]} missing in {parent}'
                    )

    def execute(self):
        rows = self.db.rows(self.name)
        self.db.calls.append((self.name, self.op, self.payload))
        matched = [r for r in rows if _matches(r, self.filters)]

        if self.op == "select":
            res = matched
            if self._order:
                res = sorted(res, key=lambda r: r.get(self._order) is None)
                res = sorted(res, key=lambda r: r.get(self._order) or 0)
            if self._desc:
                res = list(reversed(res))
            if self._limit is not None:
                res = res[: self._limit]
            if self.cols and self.cols.strip() != "*":
                keys = [c.strip() for c in self.cols.split(",") if c.strip()]
                return _Resp([{k: r.get(k) for k in keys} for r in res])
            return _Resp([dict(r) for r in res])

        if self.op == "insert":
            self._check_fk(self.payload)
            row = dict(self.payload)
            rows.append(row)
            return _Resp([dict(row)])

        if self.op == "update":
            for row in matched:
                row.update(self.payload)
            return _Resp([dict(r) for r in matched])

        if self.op == "upsert":
            conflict = [c.strip() for c in (self.on_conflict or "").split(",") if c.strip()]
            existing = None
            if conflict and all(c in self.payload for c in conflict):
                for row in rows:
                    if all(str(row.get(c)) == str(self.payload.get(c)) for c in conflict):
                        existing = row
                        break
            if existing is not None:
                if self.ignore_duplicates:
                    return _Resp([])
                existing.update(self.payload)
                return _Resp([dict(existing)])
            self._check_fk(self.payload)
            row = dict(self.payload)
            rows.append(row)
            return _Resp([dict(row)])

        if self.op == "delete":
            for row in list(matched):
                rows.remove(row)
            return _Resp([dict(r) for r in matched])

        raise AssertionError(f"unsupported op {self.op}")


# ----------------------------------------------------------------------- Discord


class FakePerms:
    def __init__(self, administrator=False, manage_guild=False, mention_everyone=True):
        self.administrator = administrator
        self.manage_guild = manage_guild
        self.mention_everyone = mention_everyone


class FakeRole:
    def __init__(self, role_id, name="role"):
        self.id = role_id
        self.name = name
        self.mention = f"<@&{role_id}>"


class FakeMember:
    def __init__(self, member_id=1, display_name="Tester", name=None, administrator=True,
                 guild=None, mention_everyone=True):
        self.id = member_id
        self.display_name = display_name
        self.name = name or display_name.lower()
        self.mention = f"<@{member_id}>"
        self.guild = guild
        self.roles = []
        self.bot = False
        self.dms = []
        self.guild_permissions = FakePerms(administrator, administrator, mention_everyone)

    async def send(self, content=None, embed=None, **kwargs):
        self.dms.append((content, embed))
        return None

    def set_guild(self, guild):
        self.guild = guild
        return self


class FakeMessage:
    def __init__(self, content="", author=None, mentions=None, attachments=None,
                 guild=None, channel=None, message_id=None, embed=None):
        self.id = message_id if message_id is not None else next(_next_message_id)
        self.content = content
        self.author = author
        self.mentions = mentions or []
        self.attachments = attachments or []
        self.guild = guild
        self.channel = channel
        self.embed = embed
        self.replies = []
        self.edited = []

    async def edit(self, content=None, embed=None, **kwargs):
        if content is not None:
            self.content = content
        if embed is not None:
            self.embed = embed
        self.edited.append((content, embed))
        return self

    async def reply(self, content=None, **kwargs):
        self.replies.append(content)
        if self.channel:
            self.channel.messages.append((content, kwargs.get("embed")))
        return FakeMessage(content=content, guild=self.guild, channel=self.channel)

    async def add_reaction(self, emoji):
        return None


class FakeChannel:
    def __init__(self, channel_id=10, guild=None, mention_everyone=True, name="war-channel"):
        self.id = channel_id
        self.guild = guild
        self.name = name
        self.mention = f"<#{channel_id}>"
        self.messages = []
        self.sent_messages = []
        self._mention_everyone = mention_everyone

    async def send(self, content=None, embed=None, **kwargs):
        message = FakeMessage(content=content, guild=self.guild, channel=self, embed=embed)
        self.messages.append((content, embed))
        self.sent_messages.append(message)
        return message

    async def fetch_message(self, message_id):
        for message in self.sent_messages:
            if message.id == int(message_id):
                return message
        raise Exception(f"message {message_id} not found")

    def permissions_for(self, member):
        if member is None:
            raise TypeError("permissions_for() received None member")
        return FakePerms(mention_everyone=self._mention_everyone)

    def last_text(self):
        for content, embed in reversed(self.messages):
            if content:
                return content
        return ""

    def texts(self):
        return [content for content, _embed in self.messages if content]


class FakeGuild:
    def __init__(self, guild_id=100, me=None):
        self.id = guild_id
        self.name = "Test Guild"
        self.me = me
        self.owner = FakeMember(1, "Owner", administrator=True, guild=self)
        self.members = []
        self.text_channels = []
        self.system_channel = None
        self.member_count = 1
        self.roles = []
        self.default_role = FakeRole(0, "@everyone")
        self._channels = {}

    def add_channel(self, channel):
        self._channels[channel.id] = channel
        self.text_channels.append(channel)
        channel.guild = self
        return channel

    def get_channel(self, channel_id):
        return self._channels.get(channel_id)

    def get_role(self, role_id):
        for role in self.roles:
            if role.id == role_id:
                return role
        return None

    def get_member(self, member_id):
        for member in self.members:
            if member.id == member_id:
                return member
        return None

    def get_member_named(self, name):
        for member in self.members:
            if member.name.lower() == str(name).lower() or member.display_name.lower() == str(name).lower():
                return member
        return None

    async def query_members(self, query=None, limit=5):
        query = (query or "").lower()
        return [m for m in self.members if query in m.name.lower()][:limit]


class FakeBot:
    def __init__(self):
        self.user = FakeMember(999, "Bot", administrator=False)
        self.guilds = []

    def get_guild(self, guild_id):
        for guild in self.guilds:
            if guild.id == guild_id:
                return guild
        return None

    def get_channel(self, channel_id):
        for guild in self.guilds:
            channel = guild.get_channel(channel_id)
            if channel:
                return channel
        return None

    def get_user(self, user_id):
        for guild in self.guilds:
            member = guild.get_member(user_id)
            if member:
                return member
        return None

    async def fetch_user(self, user_id):
        return self.get_user(user_id)

    async def wait_until_ready(self):
        return None


class FakeCtx:
    def __init__(self, guild=None, channel=None, author=None, message=None, bot=None):
        self.guild = guild or FakeGuild()
        self.channel = channel or FakeChannel(guild=self.guild)
        self.bot = bot or FakeBot()
        self.author = author or FakeMember(guild=self.guild)
        self.message = message or FakeMessage(author=self.author, guild=self.guild, channel=self.channel)
        self.sent = []
        self.command = None

    async def send(self, content=None, embed=None, **kwargs):
        self.sent.append((content, embed))
        self.channel.messages.append((content, embed))
        return FakeMessage(content=content, guild=self.guild, channel=self.channel)

    @property
    def texts(self):
        return [c for c, _e in self.sent if c]


def make_ctx(guild_id=100, channel_id=10, author_id=1, display_name="Tester",
             administrator=True):
    bot = FakeBot()
    guild = FakeGuild(guild_id, me=FakeMember(999, "Bot", administrator=False))
    bot.guilds.append(guild)
    channel = guild.add_channel(FakeChannel(channel_id, guild=guild))
    author = FakeMember(author_id, display_name, administrator=administrator, guild=guild)
    guild.members.append(author)
    return FakeCtx(guild=guild, channel=channel, author=author, bot=bot)


def call(command, instance, *args, **kwargs):
    """Invoke a discord.py Command object's underlying callback directly."""
    return command.callback(instance, *args, **kwargs)


def run(coro):
    return asyncio.run(coro)


class FakeAttachment:
    def __init__(self, filename, data):
        if isinstance(data, str):
            data = data.encode("utf-8")
        self.filename = filename
        self.size = len(data)
        self._data = data
        self.content_type = "text/csv" if filename.endswith(".csv") else "application/octet-stream"

    async def read(self):
        return self._data

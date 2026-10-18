import importlib.util
import json
import pathlib
import sqlite3
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from wechat_group_bindings import GroupBindings, legacy_group_id
spec = importlib.util.spec_from_file_location('group_reader', pathlib.Path(__file__).with_name('reader-api.py'))
api = importlib.util.module_from_spec(spec); spec.loader.exec_module(api)


class GroupRecovery(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.account = self.root/'account-A'
        self.bindings = GroupBindings(self.root, self.account)

    def test_legacy_identity_survives_leave_rename_rejoin_and_restart(self):
        old = legacy_group_id('旧群名')
        self.bindings.reconcile({'room@chatroom': '旧群名'}, [old])
        self.assertEqual(self.bindings.identifier('room@chatroom'), old)
        self.bindings.reconcile({}, [old])
        self.bindings.reconcile({'room@chatroom': '重进后的群名'}, [old])
        restored = GroupBindings(self.root, self.account)
        self.assertEqual(restored.identifier('room@chatroom'), old)
        self.assertIn('旧群名', restored.records['room@chatroom']['aliases'])

    def test_same_named_rooms_do_not_share_identity_or_inherit_ambiguous_permissions(self):
        names = {'room-A@chatroom': '同名群', 'room-B@chatroom': '同名群'}
        old = legacy_group_id('同名群')
        self.bindings.reconcile(names, [old])
        a, b = [self.bindings.identifier(u) for u in names]
        self.assertNotEqual(a, b); self.assertNotIn(old, [a, b])
        self.bindings.bind('room-A@chatroom', old, [old], names)
        self.assertEqual(self.bindings.identifier('room-A@chatroom'), old)
        self.assertEqual(self.bindings.identifier('room-B@chatroom'), b)
        with self.assertRaisesRegex(RuntimeError, 'ALREADY_ASSIGNED'):
            self.bindings.bind('room-B@chatroom', old, [old], names)

    def test_explicit_recovery_cannot_merge_two_selected_rooms(self):
        names = {'room-A@chatroom': 'A', 'room-B@chatroom': 'B'}
        self.bindings.reconcile(names)
        a, b = [self.bindings.identifier(u) for u in names]
        with self.assertRaisesRegex(RuntimeError, 'ALREADY_SELECTED'):
            self.bindings.bind('room-A@chatroom', '123', [a, '123'], names)
        self.assertEqual(self.bindings.identifier('room-A@chatroom'), a)
        with self.assertRaisesRegex(RuntimeError, 'NOT_ALLOWED'):
            self.bindings.bind('unobserved@chatroom', '123', ['123'], names)

    def test_account_isolation_and_readonly_workers_never_overwrite_bindings(self):
        self.bindings.reconcile({'room@chatroom': 'A'})
        other = GroupBindings(self.root, self.root/'account-B'); other.reconcile({'room@chatroom': 'A'})
        self.assertNotEqual(self.bindings.identifier('room@chatroom'), other.identifier('room@chatroom'))
        before = self.bindings.file.read_bytes()
        worker = GroupBindings(self.root, self.account, readonly=True)
        worker.reconcile({'unseen@chatroom': 'B'})
        self.assertEqual(worker.identifier('room@chatroom'), self.bindings.identifier('room@chatroom'))
        self.assertEqual(self.bindings.file.read_bytes(), before)

    def test_stale_writer_reloads_before_merge_and_corrupt_state_is_preserved(self):
        second = GroupBindings(self.root, self.account)
        self.bindings.reconcile({'A@chatroom': 'A'})
        second.reconcile({'B@chatroom': 'B'})
        restored = GroupBindings(self.root, self.account)
        self.assertEqual(set(restored.records), {'A@chatroom', 'B@chatroom'})
        self.bindings.file.write_text('{"version":1,"groups":{}}', encoding='utf-8')
        damaged = self.bindings.file.read_bytes()
        with self.assertRaisesRegex(RuntimeError, 'GROUP_BINDINGS_INVALID'):
            self.bindings.reconcile({'C@chatroom': 'C'})
        self.assertEqual(self.bindings.file.read_bytes(), damaged)

    def test_proven_image_history_restores_renamed_legacy_group(self):
        old = legacy_group_id('原名')
        self.bindings.reconcile({'room@chatroom': '新名字'}, [old], {'room@chatroom': old})
        self.assertEqual(self.bindings.identifier('room@chatroom'), old)

    def test_reader_uses_stable_identity_for_selection_search_and_media_permissions(self):
        reader = api.Reader.__new__(api.Reader); reader.root = self.root; reader.account = self.account
        reader.settings_file = self.root/'settings.json'; reader.settings_file.write_text(json.dumps({'messagePushFilterList': ['room@chatroom', 'unselected@chatroom']}))
        (self.root/'config').mkdir(); config = self.root/'config/wechatagent.json'
        old = legacy_group_id('旧名'); config.write_text(json.dumps({'wechat': {'whitelist': {'groups': [old], 'private': []}}}))
        reader.names = {'room@chatroom': '旧名', 'unselected@chatroom': '其他群'}; reader.group_bindings = self.bindings
        reader.own_wxid = 'self'
        reader.refresh_names = lambda **kwargs: None
        self.bindings.reconcile(reader.names, [old])
        reader.names['room@chatroom'] = '重进新名'; self.bindings.reconcile(reader.names, [old])
        self.assertEqual(reader.selected_talkers(), ['room@chatroom'])
        self.assertTrue(reader.image_talker_allowed('room@chatroom'))
        self.assertFalse(reader.image_talker_allowed('unselected@chatroom'))
        self.assertIsNone(self.bindings.identifier('unobserved@chatroom'))
        contacts = reader.contacts('旧名', 'groups')
        self.assertEqual(contacts[0]['conversationId'], old)
        self.assertEqual(reader.sessions()[0]['conversationId'], old)
        payload = reader.make_payload('room@chatroom', {'senderUsername': 'friend', 'isSend': 0, 'localType': 1, 'fullText': 'fixture', 'createTime': 1})
        self.assertEqual(payload['conversationId'], old)
        self.assertEqual(payload['groupName'], '重进新名')

    def test_session_catalog_restores_a_room_missing_from_contacts_without_reading_summary(self):
        self.account.mkdir(); file = self.account/'db_storage/session/session.db'; file.parent.mkdir(parents=True)
        connection = sqlite3.connect(file)
        connection.executescript("CREATE TABLE SessionTable(username TEXT, summary TEXT); CREATE TABLE SessionNoContactInfoTable(username TEXT,session_title TEXT); INSERT INTO SessionTable VALUES ('room@chatroom','private message must not be selected'); INSERT INTO SessionNoContactInfoTable VALUES ('room@chatroom','重进后的群');")
        connection.commit(); connection.close()
        reader = api.Reader.__new__(api.Reader); reader.account = self.account; reader.passphrase = 'fixture'; reader.group_metadata_error = ''
        statements = []
        def connect(*args):
            conn = sqlite3.connect(file); conn.set_trace_callback(statements.append); return conn, conn.cursor()
        with patch.object(api.nt, 'derive_database_key', return_value=('fixture', 'fixture')), patch.object(api.nt, 'connect_nt_db', side_effect=connect):
            self.assertEqual(reader.group_session_names(), {'room@chatroom': '重进后的群'})
        self.assertFalse(any('SELECT summary' in s or 'message_content' in s for s in statements))

    def test_fresh_session_titles_are_searchable_when_the_contact_title_is_only_an_identifier(self):
        (self.root/'config').mkdir(); (self.root/'config/wechatagent.json').write_text(json.dumps({'wechat': {'whitelist': {'groups': [], 'private': []}}}))
        reader = api.Reader.__new__(api.Reader); reader.root = self.root; reader.account = self.account
        reader.names = {}; reader.names_lock = threading.Lock(); reader.names_refreshed_at = 0
        reader.contact_db = self.root/'contact.db'; reader.passphrase = 'fixture'; reader.group_bindings = self.bindings
        reader.group_session_names = lambda: {'room@chatroom': '会话库里的新群名'}
        with patch.object(api.nt, 'derive_database_key', return_value=('key', 'salt')), patch.object(api.nt, 'load_contact_names', return_value={'friend': 'Friend', 'room@chatroom': 'room@chatroom'}):
            found = reader.contacts('新群名', 'groups', refresh=True)
        self.assertEqual(found[0]['displayName'], '会话库里的新群名')
        self.assertEqual(found[0]['conversationId'], self.bindings.identifier('room@chatroom'))


if __name__ == '__main__':
    unittest.main()

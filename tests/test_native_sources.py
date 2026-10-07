import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from autog_frontend.native_sources import load_native_sources
from autog_frontend.__main__ import main


class NativeRegistrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.path = self.root / 'sources.json'
        self.data = {'schema': 'autog-native-source-registration/1', 'sources': [
            {'source_id': 'one', 'database': str(self.root / 'absent.sqlite3'), 'snapshots': []}]}

    def write(self, data=None):
        raw = json.dumps(data or self.data).encode()
        self.path.write_bytes(raw)
        return hashlib.sha256(raw).hexdigest()

    def test_no_database_open_or_creation(self):
        digest = self.write()
        before = tuple(self.root.iterdir())
        sources = load_native_sources(self.path, digest)
        self.assertEqual(sources[0].source_id, 'one')
        self.assertEqual(sources[0].snapshots, ())
        self.assertEqual(tuple(self.root.iterdir()), before)
        self.assertFalse(sources[0].database.exists())

    def test_v2_retains_legacy_sources_and_requires_explicit_opt_field(self):
        self.data['schema'] = 'autog-native-source-registration/2'
        with self.assertRaises(ValueError): load_native_sources(self.path, self.write())
        self.data['sources'][0]['opt_readout'] = None
        source = load_native_sources(self.path, self.write())[0]
        self.assertIsNone(source.opt_readout)
        self.assertFalse(source.database.exists())

    def test_v2_bad_descriptor_or_unowned_registry_rejects(self):
        self.data['schema'] = 'autog-native-source-registration/2'
        opt = self.root / 'opt.json'
        opt.write_bytes(b'{}')
        for descriptor in ({}, {'path': str(opt), 'sha256': '0'*64},
                           {'path': str(opt), 'sha256': hashlib.sha256(b'{}').hexdigest()},
                           {'path': str(opt), 'sha256': '0'*64, 'latest': True}):
            self.data['sources'][0]['opt_readout'] = descriptor
            with self.subTest(descriptor=descriptor), self.assertRaises(ValueError):
                load_native_sources(self.path, self.write())

    def test_v3_explicit_stage_fields_and_unowned_freq_reject(self):
        self.data['schema'] = 'autog-native-source-registration/3'
        entry = self.data['sources'][0]
        entry['opt_readout'] = None
        with self.assertRaises(ValueError): load_native_sources(self.path, self.write())
        entry['freq_readout'] = None
        result = load_native_sources(self.path, self.write())[0]
        self.assertIsNone(result.freq_readout)
        candidate = self.root / 'freq.json'
        candidate.write_bytes(b'{}')
        entry['freq_readout'] = {'path':str(candidate),'sha256':hashlib.sha256(b'{}').hexdigest()}
        with self.assertRaises(ValueError): load_native_sources(self.path, self.write())

    def test_duplicate_alias_path_and_unknown_fields_reject(self):
        for change in ('alias', 'path', 'unknown', 'relative'):
            with self.subTest(change=change):
                data = json.loads(json.dumps(self.data))
                entry = data['sources'][0]
                if change == 'alias':
                    data['sources'].append({**entry, 'database': str(self.root / 'other.sqlite3')})
                elif change == 'path':
                    data['sources'].append({**entry, 'source_id': 'two'})
                elif change == 'unknown':
                    entry['provider'] = 'forbidden'
                else:
                    entry['database'] = 'relative.sqlite3'
                with self.assertRaises(ValueError):
                    load_native_sources(self.path, self.write(data))

    def test_registry_digest_duplicate_keys_and_symlink_reject(self):
        digest = self.write()
        with self.assertRaises(ValueError):
            load_native_sources(self.path, '0' * 64)
        link = self.root / 'link.json'
        link.symlink_to(self.path)
        with self.assertRaises(ValueError):
            load_native_sources(link, digest)
        raw = b'{"schema":"autog-native-source-registration/1","sources":[],"sources":[]}'
        self.path.write_bytes(raw)
        with self.assertRaises(ValueError):
            load_native_sources(self.path, hashlib.sha256(raw).hexdigest())

    def test_snapshot_digest_and_owner_validation_reject(self):
        snapshot = self.root / 'snapshot.json'
        snapshot.write_bytes(b'{}')
        for digest in ('0' * 64, hashlib.sha256(b'{}').hexdigest()):
            self.data['sources'][0]['snapshots'] = [{'path': str(snapshot), 'sha256': digest}]
            with self.assertRaises(ValueError):
                load_native_sources(self.path, self.write())

    def test_cli_pair_required_before_app(self):
        argv = ['autog', '--database', str(self.root / 'absent.sqlite3'), '--no-token']
        for flag in (['--native-sources', str(self.path)], ['--native-sources-sha256', '0' * 64]):
            with self.subTest(flag=flag), patch.object(sys, 'argv', argv + flag), \
                    patch('autog_frontend.api.create_app') as create:
                with self.assertRaises(SystemExit) as error:
                    main()
                self.assertEqual(error.exception.code, 2)
                create.assert_not_called()

    def test_cli_passes_immutable_registration_without_optional_services(self):
        digest = self.write()
        argv = ['autog', '--database', str(self.root / 'absent.sqlite3'), '--no-token',
                '--native-sources', str(self.path), '--native-sources-sha256', digest]
        with patch.object(sys, 'argv', argv), patch('uvicorn.run') as run, \
                patch('autog_frontend.api.create_app', return_value='app') as create:
            main()
            self.assertEqual(create.call_args.kwargs['native_sources'][0].source_id, 'one')
            self.assertIsNone(create.call_args.kwargs['monitor'])
            self.assertIsNone(create.call_args.kwargs['task_queue'])
            self.assertIsNone(create.call_args.kwargs['library_manager'])
            self.assertEqual(run.call_args.args, ('app',))

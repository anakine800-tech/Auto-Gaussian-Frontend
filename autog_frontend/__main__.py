"""Launch only on loopback; the data root comes solely from local startup."""
import argparse
import os
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser(description='Local read-only ag study viewer')
    parser.add_argument('--studies-root', type=Path, default=os.environ.get('AG_STUDIES_ROOT'), help='Existing study parent directory (or AG_STUDIES_ROOT)')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--enable-actions', action='store_true', help='Enable local ag operations with Mac confirmation still enforced by ag')
    parser.add_argument('--ag', type=Path, help='Trusted local ag executable; defaults to PATH')
    ui = parser.add_mutually_exclusive_group()
    ui.add_argument('--ui-directory', type=Path, help='Local Vite build directory')
    ui.add_argument('--ui', action='store_true', help='Serve the UI bundled in an installed wheel')
    args = parser.parse_args()
    if not sys.dont_write_bytecode:
        parser.error('start Python with -B or PYTHONDONTWRITEBYTECODE=1')
    if args.studies_root is None or not 1024 <= args.port <= 65535:
        parser.error('provide --studies-root (or AG_STUDIES_ROOT) and a port from 1024 to 65535')
    from .api import create_app
    from .studies import StudyError
    try:
        directory = Path(__file__).resolve().parent / 'ui' if args.ui else args.ui_directory
        app = create_app(args.studies_root, directory.absolute() if directory else None,
                         enable_actions=args.enable_actions, ag=args.ag)
    except (StudyError, OSError, ValueError) as exc:
        parser.error(str(exc))
    import uvicorn
    mode = 'local ag actions enabled' if args.enable_actions else 'read-only'
    print(f'http://127.0.0.1:{args.port} — study viewer · {mode}', flush=True)
    uvicorn.run(app, host='127.0.0.1', port=args.port, access_log=False, proxy_headers=False,
                server_header=False, limit_concurrency=8, timeout_keep_alive=5, log_level='warning')


if __name__ == '__main__':
    main()

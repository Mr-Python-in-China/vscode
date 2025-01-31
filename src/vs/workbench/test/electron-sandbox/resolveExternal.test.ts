/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from 'vs/base/test/common/utils';
import { NativeWindow } from 'vs/workbench/electron-sandbox/window';
import { RemoteTunnel } from 'vs/platform/tunnel/common/tunnel';
import { URI } from 'vs/base/common/uri';

type PortMap = Record<number, number>;

class TunnelMock {
	private assignedPorts: PortMap = {};
	private expectedDispose = false;

	reset(ports: PortMap) {
		this.assignedPorts = ports;
	}

	expectDispose() {
		this.expectedDispose = true;
	}

	openTunnel(_address: string, port: number): Promise<RemoteTunnel | string | undefined> {
		if (!this.assignedPorts[port]) {
			return Promise.reject(new Error('Unexpected tunnel request'));
		}
		const res: RemoteTunnel = {
			localAddress: `localhost:${this.assignedPorts[port]}`,
			tunnelRemoteHost: '4.3.2.1',
			tunnelRemotePort: this.assignedPorts[port],
			privacy: '',
			dispose: () => {
				assert(this.expectedDispose, 'Unexpected dispose');
				this.expectedDispose = false;
				return Promise.resolve();
			}
		};
		delete this.assignedPorts[port];
		return Promise.resolve(res);
	}

	validate() {
		try {
			assert(Object.keys(this.assignedPorts).length === 0, 'Expected tunnel to be used');
			assert(!this.expectedDispose, 'Expected dispose to be called');
		} finally {
			this.expectedDispose = false;
		}
	}
}

suite('NativeWindow:resolveExternal', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	const tunnelMock = new TunnelMock();

	async function doTest(uri: string, ports: PortMap = {}, expectedUri?: string) {
		tunnelMock.reset(ports);
		const res = await NativeWindow.prototype.resolveExternalUri.call(tunnelMock, URI.parse(uri), {
			allowTunneling: true,
			openExternal: true
		});
		assert.strictEqual(!expectedUri, !res, `Expected URI ${expectedUri} but got ${res}`);
		if (expectedUri && res) {
			assert.strictEqual(res.resolved.toString(), URI.parse(expectedUri).toString());
		}
		tunnelMock.validate();
	}
	test('invalid', async () => {
		await doTest('file:///foo.bar/baz');
		await doTest('http://foo.bar/path');
	});
	test('simple', async () => {
		await doTest('http://localhost:1234/path', { 1234: 1234 }, 'http://localhost:1234/path');
	});
	test('all interfaces', async () => {
		await doTest('http://0.0.0.0:1234/path', { 1234: 1234 }, 'http://localhost:1234/path');
	});
	test('changed port', async () => {
		await doTest('http://localhost:1234/path', { 1234: 1235 }, 'http://localhost:1235/path');
	});
	test('query', async () => {
		await doTest('http://foo.bar/path?a=b&c=http%3a%2f%2flocalhost%3a4455', { 4455: 4455 }, 'http://foo.bar/path?a=b&c=http%3a%2f%2flocalhost%3a4455');
	});
	test('query with different port', async () => {
		tunnelMock.expectDispose();
		await doTest('http://foo.bar/path?a=b&c=http%3a%2f%2flocalhost%3a4455', { 4455: 4567 });
	});
	test('both url and query', async () => {
		await doTest('http://localhost:1234/path?a=b&c=http%3a%2f%2flocalhost%3a4455',
			{ 1234: 4321, 4455: 4455 },
			'http://localhost:4321/path?a=b&c=http%3a%2f%2flocalhost%3a4455');
	});
	test('both url and query, query rejected', async () => {
		tunnelMock.expectDispose();
		await doTest('http://localhost:1234/path?a=b&c=http%3a%2f%2flocalhost%3a4455',
			{ 1234: 4321, 4455: 5544 },
			'http://localhost:4321/path?a=b&c=http%3a%2f%2flocalhost%3a4455');
	});
});

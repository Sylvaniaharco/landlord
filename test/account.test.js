import test from 'node:test';
import assert from 'node:assert/strict';
import { accountFrom, loginUrl } from '../src/ui/account.js';

test('accountFrom: login Google = masuk, tamu Mahjong = belum masuk, server tidak ada = off', () => {
  assert.deepEqual(accountFrom({ user: { id: 'x', name: 'Ani', guest: false, picture: 'https://lh3.googleusercontent.com/a' }, wallet: { coins: 1234.7 } }, { google: true }),
    { state: 'in', name: 'Ani', picture: 'https://lh3.googleusercontent.com/a', coins: 1234 });
  assert.equal(accountFrom({ user: { name: 'Ani' } }, null).coins, null, 'tanpa dompet = saldo tidak diketahui');
  assert.equal(accountFrom({ user: { name: 'Ani', picture: 'javascript:alert(1)' } }, null).picture, '');
  assert.deepEqual(accountFrom({ user: { name: 'Bambu 12', guest: true } }, { google: true }), { state: 'out' });
  assert.deepEqual(accountFrom({ user: null }, { google: true }), { state: 'out' });
  assert.deepEqual(accountFrom({ user: null }, { google: false }), { state: 'off' });
  assert.deepEqual(accountFrom(null, null), { state: 'off' });
  assert.ok(!accountFrom({ user: { id: 'g:1', name: 'A' } }, {}).id, 'id akun tidak dipakai di HP');
});

test('login lewat server akun Mahjong, kembali ke Doudizhu (kunci next=doudizhu)', () => {
  assert.equal(loginUrl, '/games/mahjonghk/api/auth/google?next=doudizhu');
});

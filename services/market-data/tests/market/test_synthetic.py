import numpy as np

from market_data.market import synthetic


def test_same_seed_same_hash_and_different_seed_differs():
    a = synthetic.generate_block(0, 20, 50)
    b = synthetic.generate_block(0, 20, 50)
    c = synthetic.generate_block(0, 20, 50, seed=1)
    assert synthetic.frame_hash(a) == synthetic.frame_hash(b)
    assert synthetic.frame_hash(a) != synthetic.frame_hash(c)


def test_every_row_satisfies_ohlc_rules():
    df = synthetic.generate_block(1, 50, 300)
    o, h, l, c, v = (df[x].to_numpy() for x in ("open", "high", "low", "close", "volume"))
    assert (o > 0).all() and (h > 0).all() and (l > 0).all() and (c > 0).all()
    assert (h >= np.maximum(o, c)).all() and (l <= np.minimum(o, c)).all()
    assert (v >= 0).all() and df["volume"].dtype.is_integer()


def test_sessions_are_weekdays_and_unique():
    s = synthetic.sessions(100)
    assert len(set(s)) == 100 and np.is_busday(s).all()

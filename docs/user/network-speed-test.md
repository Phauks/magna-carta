# Network Speed Test

The Network Speed Test measures the connection you are working on right now. Find it under
**Tools → Network Speed Test**. Nothing you do here is saved, and it is not attached to any matter.

## Running a test

Press **Start**. The test takes about a minute and transfers a substantial amount of data — around
200 MB — so avoid running it on a metered or tethered connection. It does not begin on its own.

While it runs you may **Pause** and **Resume**, or **Cancel** to abandon it. When it finishes,
**Retest** runs it again.

## What the numbers mean

- **Download** and **Upload** — how much data your connection carries per second. Higher is better.
  The chart under each figure shows every sample across the run, with a line marking the 90th
  percentile — the value the headline figure reports.
- **Latency** — how long a single request takes to make the round trip. Lower is better.
- **Jitter** — how much that latency varies. High jitter makes video calls stutter even when the
  download speed looks healthy.
- **Packet loss** — currently unavailable. Measuring it requires a separate kind of server that is
  no longer offered publicly.

## The quality score

Once a run finishes, it earns a **Network quality score** — Cloudflare's Aggregated Internet
Measurement rating for video streaming, online gaming, and video calls, each rated from bad to
great. The score appears only when the run is complete, because a rating shown mid-test climbs and
falls before the measurements behind it exist. **Learn more** beside the heading opens Cloudflare's
explanation of how the scores are calculated.

## Is it the internet, or is it Magna Carta?

The **Your connection** panel shows the round trip to Magna Carta, measured as a real request. Read
it beside the numbers above:

- Slow download **and** a slow round trip — the connection is struggling.
- Healthy round trip **but** slow download — the connection is constrained somewhere other than the
  path to us.
- "Magna Carta could not be reached" — the network is blocking or failing to route to us. Your
  internet may still be fine.

## Options and saving a result

The **⋯** menu holds two switches, both off by default:

- **Low internet usage** — runs only the smaller transfers, using well under 20 MB instead of about
  200 MB. It saves data, but a fast connection measures slower than it is, and the result is no
  longer comparable to other speed tests.
- **Start automatically** — begins a test as soon as the page opens.

After a run finishes, **Download report** in the same menu saves the result as a plain-text file you
can paste into an email — the numbers, the quality ratings, the measurement server, and the data the
test spent.

## Privacy

Running the test shares your public address with Cloudflare's measurement endpoints, which is how
they route and time the transfer. No firm data, client data, or file content is ever sent — only
meaningless test bytes. Results are not stored.

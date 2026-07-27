## Calrec Assist

This module provides integration with Calrec Assist.

### Configuration

- **Calrec Assist IP**: The IP address of Calrec Assist
- **Target Port**: HTTP port for the GraphQL API (default: 80)
- **Username**: Assist login username (default: Engineer)
- **Password**: Assist login password (stored as a secret)

### Actions

- **Set Fader Cut**: Toggle or set the cut (mute) state of a fader
- **Set Fader PFL**: Toggle or set the PFL (Pre-Fade Listen) state of a fader
- **Set Fader Level**: Set the fader level using the 0-1023 range
- **Set Fader Level (dB)**: Set the fader level using dB values

### Feedbacks

- **Fader Cut State**: Visual feedback when a fader is cut
- **Fader PFL State**: Visual feedback when a fader has PFL active

### Variables

The module provides variables for each fader (1-256):

- `fader_X_level`: Current fader level (0-1023)
- `fader_X_level_db`: Current fader level in dB
- `fader_X_label`: Fader label
- `fader_X_pfl`: PFL state (On/Off)
- `fader_X_cut`: Cut state (Cut/On)

### Presets

Pre-configured button presets are available for the first 16 faders, including cut and PFL toggle buttons.

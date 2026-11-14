//! What a disarm took out. Counts by kind, so a person can see that something was removed and what
//! sort of thing it was, without the report ever repeating the content it removed.

/// One sort of thing a disarm removes or neutralizes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum RemovalKind {
    /// Script: PDF JavaScript, an Office macro project.
    Script,
    /// Something that runs on its own: a PDF open action or additional action.
    AutomaticAction,
    /// An action that starts a program, submits a form, or opens another file.
    ExternalAction,
    /// A file carried inside the document.
    EmbeddedFile,
    /// An embedded object, emptied so it can no longer be opened.
    EmbeddedObject,
    /// An ActiveX or other control.
    Control,
    /// A dynamic form (XFA), which carries its own script.
    DynamicForm,
    /// Multimedia, 3D or other content that runs its own player.
    ActiveContent,
    /// A link fetched without asking: a remote template, a linked picture, a network path.
    ExternalLink,
    /// A field or formula that runs a command or pulls content from elsewhere (DDE, INCLUDETEXT).
    DynamicField,
    /// A custom ribbon, which can call macros.
    CustomInterface,
    /// A picture's metadata, and any bytes riding behind the picture.
    PictureMetadata,
    /// An animated picture reduced to its first frame.
    AnimationFlattened,
}

impl RemovalKind {
    /// The stable code crossing the WebAssembly edge and the container's response.
    pub fn code(self) -> &'static str {
        match self {
            Self::Script => "script",
            Self::AutomaticAction => "automaticAction",
            Self::ExternalAction => "externalAction",
            Self::EmbeddedFile => "embeddedFile",
            Self::EmbeddedObject => "embeddedObject",
            Self::Control => "control",
            Self::DynamicForm => "dynamicForm",
            Self::ActiveContent => "activeContent",
            Self::ExternalLink => "externalLink",
            Self::DynamicField => "dynamicField",
            Self::CustomInterface => "customInterface",
            Self::PictureMetadata => "pictureMetadata",
            Self::AnimationFlattened => "animationFlattened",
        }
    }
}

/// How many of one kind were removed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Removal {
    pub kind: RemovalKind,
    pub count: u32,
}

/// Everything one disarm removed, in a stable order. Empty means the document carried nothing that
/// acts, which is itself the finding a person came for.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DisarmReport {
    counts: std::collections::BTreeMap<RemovalKind, u32>,
}

impl DisarmReport {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record `count` more removals of `kind`. Zero records nothing.
    pub fn add(&mut self, kind: RemovalKind, count: u32) {
        if count == 0 {
            return;
        }
        let entry = self.counts.entry(kind).or_insert(0);
        *entry = entry.saturating_add(count);
    }

    /// Fold another report (an embedded package's) into this one.
    pub fn absorb(&mut self, other: &DisarmReport) {
        for (kind, count) in &other.counts {
            self.add(*kind, *count);
        }
    }

    pub fn count(&self, kind: RemovalKind) -> u32 {
        self.counts.get(&kind).copied().unwrap_or(0)
    }

    pub fn is_empty(&self) -> bool {
        self.counts.is_empty()
    }

    pub fn removals(&self) -> Vec<Removal> {
        self.counts
            .iter()
            .map(|(kind, count)| Removal {
                kind: *kind,
                count: *count,
            })
            .collect()
    }
}

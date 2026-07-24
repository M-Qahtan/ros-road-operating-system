# Publishing This Foundation to GitHub

The intended remote is:

```text
git@github.com:M-Qahtan/ros-road-operating-system.git
```

## From this worktree

```bash
git remote add origin git@github.com:M-Qahtan/ros-road-operating-system.git
git push -u origin main
git push -u origin agent/bootstrap-ros-foundation
```

Then open a draft pull request from `agent/bootstrap-ros-foundation` into `main` titled:

```text
bootstrap ROS engineering foundation
```

## From the Git bundle

```bash
git clone ros-road-operating-system.bundle ros-road-operating-system
cd ros-road-operating-system
git remote set-url origin git@github.com:M-Qahtan/ros-road-operating-system.git
git push -u origin main
git push -u origin agent/bootstrap-ros-foundation
```

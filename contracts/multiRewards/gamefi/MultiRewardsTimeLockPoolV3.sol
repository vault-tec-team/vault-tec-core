// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

import "contracts/multiRewards/gamefi/base/MultiRewardsBasePoolV3.sol";
import "contracts/interfaces/ITimeLockPool.sol";

contract MultiRewardsTimeLockPoolV3 is MultiRewardsBasePoolV3, ITimeLockPool {
    using Math for uint256;
    using SafeERC20 for IERC20;

    uint256 public immutable maxBonus;
    uint256 public immutable minLockDuration;
    uint256 public immutable maxLockDuration;
    uint256 public constant MIN_LOCK_DURATION_FOR_SAFETY = 10 minutes;
    uint256 public gracePeriod = 7 days;
    uint256 public kickRewardIncentive = 100;
    uint256 public constant DENOMINATOR = 10000;

    mapping(address => Deposit[]) public depositsOf;

    mapping(address => mapping(uint256 => uint256)) public badgesBoostedMapping;  // badge address => id => boosted number (should divided by 1e18)
    mapping(address => mapping(uint256 => bool)) public inBadgesList; // badge address => id => bool

    BadgeData[] public badgesList;

    mapping(address => Delegate[]) public delegatesOf;
    mapping(address => mapping(address => mapping(uint256 => bool))) public delegatedList;

    mapping(address => bool) public ineligibleList;

    bool public migrationIsOn;

    event Deposited(uint256 amount, uint256 duration, address indexed receiver, address indexed from);
    event Withdrawn(uint256 indexed depositId, address indexed receiver, address indexed from, uint256 amount);
    event MigrationTurnOff(address by);
    event GracePeriodUpdated(uint256 _gracePeriod);
    event KickRewardIncentiveUpdated(uint256 _kickRewardIncentive);
    event BadgeAdded(address indexed _badgeAddress, uint256 _id, uint256 _boostedNumber);
    event BadgeUpdated(address indexed _badgeAddress, uint256 _id, uint256 _boostedNumber);
    event IneligibleListAdded(address indexed _address);
    event IneligibleListRemoved(address indexed _address);

    struct BadgeData {
        address contractAddress;
        uint256 tokenId;
    }

    struct Delegate {
        address owner;
        BadgeData badge; 
    }

    struct Deposit {
        uint256 amount;
        uint64 start;
        uint64 end;
        uint256 badgeBoostingAmount;
    }
    constructor(
        string memory _name,
        string memory _symbol,
        address _depositToken,
        address[] memory _rewardTokens,
        address[] memory _escrowPools,
        uint256[] memory _escrowPortions,
        uint256[] memory _escrowDurations,
        uint256 _maxBonus,
        uint256 _minLockDuration,
        uint256 _maxLockDuration
    ) MultiRewardsBasePoolV3(_name, _symbol, _depositToken, _rewardTokens, _escrowPools, _escrowPortions, _escrowDurations) {
        require(
            _minLockDuration >= MIN_LOCK_DURATION_FOR_SAFETY, 
            "MultiRewardsTimeLockPoolV3.constructor: min lock duration must be greater or equal to mininmum lock duration for safety"
        );
        require(
            _maxLockDuration >= _minLockDuration, 
            "MultiRewardsTimeLockPoolV3.constructor: max lock duration must be greater or equal to mininmum lock duration"
        );
        maxBonus = _maxBonus;
        minLockDuration = _minLockDuration;
        maxLockDuration = _maxLockDuration;

        migrationIsOn = true;
    }

    function deposit(uint256 _amount, uint256 _duration, address _receiver) external override nonReentrant {
        _deposit(_msgSender(), _amount, _duration, _receiver, false);
    }

    function batchDeposit(
        uint256[] memory _amounts, 
        uint256[] memory _durations, 
        address[] memory _receivers) external nonReentrant {
        require(_amounts.length == _durations.length, 
            "MultiRewardsTimeLockPoolV3.batchDeposit: amounts and durations length mismatch");
        require(_amounts.length == _receivers.length, 
            "MultiRewardsTimeLockPoolV3.batchDeposit: amounts and receivers length mismatch");

        for (uint256 i = 0; i < _receivers.length; i++){
            _deposit(_msgSender(), _amounts[i],_durations[i],_receivers[i], false);
        }
    }

    function _deposit(address _depositor, uint256 _amount, uint256 _duration, address _receiver, bool relock) internal {
        require(_depositor != address(0), "MultiRewardsTimeLockPoolV3._deposit: depositor cannot be zero address");
        require(_receiver != address(0), "MultiRewardsTimeLockPoolV3._deposit: receiver cannot be zero address");
        require(_amount > 0, "MultiRewardsTimeLockPoolV3._deposit: cannot deposit 0");
        // Don't allow locking > maxLockDuration
        uint256 duration = _duration.min(maxLockDuration);
        // Enforce min lockup duration to prevent flash loan or MEV transaction ordering
        duration = duration.max(minLockDuration);

        if (!relock) {
            depositToken.safeTransferFrom(_depositor, address(this), _amount);
        }

        depositsOf[_receiver].push(Deposit({
            amount: _amount,
            start: uint64(block.timestamp),
            end: uint64(block.timestamp) + uint64(duration),
            badgeBoostingAmount: _amount * getBadgeMultiplier(_receiver)/ 1e18
        }));

        uint256 mintAmount = _amount * getMultiplier(duration) / 1e18;
        uint256 badgeBoostingAmount = _amount * getBadgeMultiplier(_receiver)/ 1e18;

        _mint(_receiver, mintAmount+badgeBoostingAmount);
        emit Deposited(_amount, duration, _receiver, _depositor);
    }

    function withdraw(uint256 _depositId, address _receiver) external nonReentrant {
        require(_receiver != address(0), "MultiRewardsTimeLockPoolV3.withdraw: receiver cannot be zero address");
        require(_depositId < depositsOf[_msgSender()].length, "MultiRewardsTimeLockPoolV3.withdraw: Deposit does not exist");
        Deposit memory userDeposit = depositsOf[_msgSender()][_depositId];
        require(block.timestamp >= userDeposit.end, "MultiRewardsTimeLockPoolV3.withdraw: too soon");

        // No risk of wrapping around on casting to uint256 since deposit end always > deposit start and types are 64 bits
        uint256 shareAmount = userDeposit.amount * getMultiplier(uint256(userDeposit.end - userDeposit.start)) / 1e18;
        uint256 badgeAmount = userDeposit.badgeBoostingAmount;

        // remove Deposit
        depositsOf[_msgSender()][_depositId] = depositsOf[_msgSender()][depositsOf[_msgSender()].length - 1];
        depositsOf[_msgSender()].pop();

        // burn pool shares
        _burn(_msgSender(), shareAmount+badgeAmount);
        
        // return tokens
        depositToken.safeTransfer(_receiver, userDeposit.amount);
        emit Withdrawn(_depositId, _receiver, _msgSender(), userDeposit.amount);
    }

    function kickExpiredDeposit(address _account, uint256 _depositId) external nonReentrant {
        _processExpiredDeposit(_account, _depositId, false, 0);
    }

    function processExpiredLock(uint256 _depositId, uint256 _duration) external nonReentrant {
        _processExpiredDeposit(msg.sender, _depositId, true, _duration);
    }

    function _processExpiredDeposit(address _account, uint256 _depositId, bool relock, uint256 _duration) internal {
        require(_account != address(0), "MultiRewardsTimeLockPoolV3._processExpiredDeposit: account cannot be zero address");
        require(_depositId < depositsOf[_account].length, "MultiRewardsTimeLockPoolV3._processExpiredDeposit: deposit does not exist");
        Deposit memory userDeposit = depositsOf[_account][_depositId];
        require(block.timestamp >= userDeposit.end, "MultiRewardsTimeLockPoolV3._processExpiredDeposit: too soon");

        uint256 returnAmount = userDeposit.amount;
        uint256 reward = 0;
        if (block.timestamp >= userDeposit.end + gracePeriod) {
            //penalty
            reward = userDeposit.amount * kickRewardIncentive / DENOMINATOR;
            returnAmount -= reward;
        }

        uint256 shareAmount = userDeposit.amount * getMultiplier(uint256(userDeposit.end - userDeposit.start)) / 1e18;

        // remove Deposit
        depositsOf[_account][_depositId] = depositsOf[_account][depositsOf[_account].length - 1];
        depositsOf[_account].pop();

        // burn pool shares
        _burn(_account, shareAmount);

        if (relock) {
            _deposit(_msgSender(), returnAmount, _duration, _account, true);
        } else {
            depositToken.safeTransfer(_account, returnAmount);
        }

        if (reward > 0) {
            depositToken.safeTransfer(msg.sender, reward);
        }
    }

    function getMultiplier(uint256 _lockDuration) public view returns(uint256) {
        return 1e18 + (maxBonus * _lockDuration / maxLockDuration);
    }

    function getBadgeMultiplier(address _depositorAddress) private view returns(uint256) {
        uint256 badgeMultiplier = 0;

        if(ineligibleList[_depositorAddress]){
            return badgeMultiplier;
        }

        for (uint256 index = 0; index < delegatesOf[_depositorAddress].length; index++) {
            Delegate memory delegateBadge = delegatesOf[_depositorAddress][index];
            BadgeData memory badge = delegateBadge.badge;
            if (IERC1155(badge.contractAddress).balanceOf(delegateBadge.owner, badge.tokenId) > 0) {
                badgeMultiplier = badgeMultiplier + (badgesBoostedMapping[badge.contractAddress][badge.tokenId]);
            } 
        }

        return badgeMultiplier;
    }

    function delegateBadgeTo(address _badgeContract,uint256 _tokenId, address _delegator) external {
        require(!delegatedList[msg.sender][_badgeContract][_tokenId], 
            "MultiRewardsTimeLockPoolV3.delegateBadgeTo: already delegated");
        require(IERC1155(_badgeContract).balanceOf(msg.sender, _tokenId) > 0, 
            "MultiRewardsTimeLockPoolV3.delegateBadgeTo: You do not own the badge");

        delegatesOf[_delegator].push(Delegate({
            owner: msg.sender,
            badge: BadgeData({
                contractAddress: _badgeContract,
                tokenId: _tokenId
            })
        }));

        delegatedList[msg.sender][_badgeContract][_tokenId] = true;
    }

    function getTotalDeposit(address _account) public view returns(uint256) {
        uint256 total;
        for(uint256 i = 0; i < depositsOf[_account].length; i++) {
            total += depositsOf[_account][i].amount;
        }

        return total;
    }

    function getDepositsOf(address _account) public view returns(Deposit[] memory) {
        return depositsOf[_account];
    }

    function getDepositsOfLength(address _account) public view returns(uint256) {
        return depositsOf[_account].length;
    }

    //==================== ADMIN ONLY FUNCTIONS ====================
    function migrationDeposit(
        uint256 _amount, 
        uint64 _start, 
        uint64 _end, 
        address _receiver) public nonReentrant onlyAdmin {
        _migrationDeposit(_amount, _start, _end, _receiver);
    }

    function batchMigrationDeposit(
        uint256[] memory _amounts, 
        uint64[] memory _starts, 
        uint64[] memory _ends, 
        address[] memory _receivers) external nonReentrant onlyAdmin {
        require(_amounts.length == _starts.length, 
            "MultiRewardsTimeLockPoolV3.batchMigrationDeposit: amounts and starts length mismatch");
        require(_amounts.length == _ends.length, 
            "MultiRewardsTimeLockPoolV3.batchMigrationDeposit: amounts and ends length mismatch");
        require(_amounts.length ==  _receivers.length, 
            "MultiRewardsTimeLockPoolV3.batchMigrationDeposit: amounts and receivers length mismatch");

        for (uint256 i = 0; i < _receivers.length; i++){
            _migrationDeposit(_amounts[i],_starts[i],_ends[i],_receivers[i]);
        }
    }

    function _migrationDeposit(uint256 _amount, uint64 _start, uint64 _end, address _receiver) internal {
        require(migrationIsOn, "MultiRewardsTimeLockPoolV3._migrationDeposit: only for migration");
        require(_receiver != address(0), 
            "MultiRewardsTimeLockPoolV3._migrationDeposit: receiver cannot be zero address");
        require(_amount > 0, "MultiRewardsTimeLockPoolV3._migrationDeposit: cannot deposit 0");
        require(_end > _start, "MultiRewardsTimeLockPoolV3._migrationDeposit: invalid duration");
       
        depositToken.safeTransferFrom(_msgSender(), address(this), _amount);

        depositsOf[_receiver].push(Deposit({
            amount: _amount,
            start: _start,
            end: _end,
            badgeBoostingAmount: _amount * getBadgeMultiplier(_receiver) / 1e18
        }));

		uint256 duration = _end - _start;
        uint256 mintAmount = _amount * getMultiplier(duration) / 1e18;
        uint256 badgeBoostingAmount = _amount * getBadgeMultiplier(_receiver) / 1e18;


        _mint(_receiver, mintAmount + badgeBoostingAmount);
        emit Deposited(_amount, duration, _receiver, _msgSender());
    }

    function turnOffMigration() public onlyAdmin {
        require(migrationIsOn,"MultiRewardsTimeLockPoolV3.turnOffMigration: migration already turned off");
        migrationIsOn = false;
        emit MigrationTurnOff(_msgSender());
    }

    function updateGracePeriod(uint256 _gracePeriod) external onlyAdmin {
        gracePeriod = _gracePeriod;
        emit GracePeriodUpdated(_gracePeriod);
    }

    function updateKickRewardIncentive(uint256 _kickRewardIncentive) external onlyAdmin {
        require(
            _kickRewardIncentive <= DENOMINATOR,
            "MultiRewardsTimeLockPoolV3.updateKickRewardIncentive: kick reward incentive cannot be greater than 100%"
        );
        kickRewardIncentive = _kickRewardIncentive;
        emit KickRewardIncentiveUpdated(_kickRewardIncentive);
    }

    function addBadge(address _badgeAddress, uint256 _id, uint256 _boostedNumber) external onlyAdmin {
        require(!inBadgesList[_badgeAddress][_id], "MultiRewardsTimeLockPoolV3.addBadge: already in badgelist, please try to update");

        inBadgesList[_badgeAddress][_id] = true;
        badgesList.push(BadgeData({
            contractAddress: _badgeAddress,
            tokenId: _id
        }));
        badgesBoostedMapping[_badgeAddress][_id] = _boostedNumber;
        emit BadgeAdded(_badgeAddress, _id, _boostedNumber);
    }

    function updateBadge(address _badgeAddress, uint256 _id, uint256 _boostedNumber) external onlyAdmin {
        require(inBadgesList[_badgeAddress][_id], "MultiRewardsTimeLockPoolV3.updateBadge: badgeAddress not in badgeList, please try to add first");
        
        badgesBoostedMapping[_badgeAddress][_id] = _boostedNumber;
        emit BadgeUpdated(_badgeAddress, _id, _boostedNumber);
    }

    function addIneligibleList(address _address) external onlyAdmin {
        require(!ineligibleList[_address], "MultiRewardsTimeLockPoolV3.addIneligibleList: address already in ineligiblelist, please try to update");
        ineligibleList[_address] = true;
        emit IneligibleListAdded(_address);
    }

    function removeIneligibleList(address _address) external onlyAdmin {
        require(ineligibleList[_address], "MultiRewardsTimeLockPoolV3.removeIneligibleList: address not in ineligiblelist, please try to add first");
        ineligibleList[_address] = false;
        emit IneligibleListRemoved(_address);
    }
}
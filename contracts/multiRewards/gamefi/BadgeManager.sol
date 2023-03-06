// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";

contract BadgeManager is AccessControlEnumerable {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    mapping(address => mapping(uint256 => uint256)) public badgesBoostedMapping; // badge address => id => boosted number (should divided by 1e18)
    mapping(address => mapping(uint256 => bool)) public inBadgesList; // badge address => id => bool

    BadgeData[] public badgesList;

    mapping(address => Delegate[]) public delegatesOf;
    mapping(address => mapping(uint256 => address)) public delegatedList;

    mapping(address => bool) public ineligibleList;

    bool public migrationIsOn;

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

    constructor() {
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _setupRole(ADMIN_ROLE, _msgSender());
    }

    function getBadgeMultiplier(address _depositorAddress) public view returns (uint256) {
        uint256 badgeMultiplier = 0;

        if (ineligibleList[_depositorAddress]) {
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

    modifier onlyAdmin() {
        require(hasRole(ADMIN_ROLE, msg.sender), "BadgeManager: only admin");
        _;
    }

    function delegateBadgeTo(
        address _badgeContract,
        uint256 _tokenId,
        address _delegator
    ) external {
        require(inBadgesList[_badgeContract][_tokenId], "BadgeManager.delegateBadgeTo: invalid badge");
        require(
            delegatedList[_badgeContract][_tokenId] == address(0),
            "BadgeManager.delegateBadgeTo: already delegated"
        );

        require(
            IERC1155(_badgeContract).balanceOf(msg.sender, _tokenId) > 0,
            "BadgeManager.delegateBadgeTo: You do not own the badge"
        );

        delegatesOf[_delegator].push(
            Delegate({ owner: msg.sender, badge: BadgeData({ contractAddress: _badgeContract, tokenId: _tokenId }) })
        );

        delegatedList[_badgeContract][_tokenId] = _delegator;
    }

    function addBadge(
        address _badgeAddress,
        uint256 _id,
        uint256 _boostedNumber
    ) external onlyAdmin {
        require(!inBadgesList[_badgeAddress][_id], "BadgeManager.addBadge: already in badgelist, please try to update");

        inBadgesList[_badgeAddress][_id] = true;
        badgesList.push(BadgeData({ contractAddress: _badgeAddress, tokenId: _id }));
        badgesBoostedMapping[_badgeAddress][_id] = _boostedNumber;
        emit BadgeAdded(_badgeAddress, _id, _boostedNumber);
    }

    function updateBadge(
        address _badgeAddress,
        uint256 _id,
        uint256 _boostedNumber
    ) external onlyAdmin {
        require(
            inBadgesList[_badgeAddress][_id],
            "BadgeManager.updateBadge: badgeAddress not in badgeList, please try to add first"
        );

        badgesBoostedMapping[_badgeAddress][_id] = _boostedNumber;
        emit BadgeUpdated(_badgeAddress, _id, _boostedNumber);
    }

    function addIneligibleList(address _address) external onlyAdmin {
        require(
            !ineligibleList[_address],
            "BadgeManager.addIneligibleList: address already in ineligiblelist, please try to update"
        );
        ineligibleList[_address] = true;
        emit IneligibleListAdded(_address);
    }

    function removeIneligibleList(address _address) external onlyAdmin {
        require(
            ineligibleList[_address],
            "BadgeManager.removeIneligibleList: address not in ineligiblelist, please try to add first"
        );
        ineligibleList[_address] = false;
        emit IneligibleListRemoved(_address);
    }

    function getDelegatesOf(address _account) public view returns (Delegate[] memory) {
        return delegatesOf[_account];
    }

    function getDelegatesOfLength(address _account) public view returns (uint256) {
        return delegatesOf[_account].length;
    }

    function getDelegatedList(address _badgeContract, uint256 _tokenId) public view returns (address) {
        return delegatedList[_badgeContract][_tokenId];
    }

    function getDelegatedLists(address[] memory _badgeContracts, uint256[] memory _tokenIds)
        public
        view
        returns (address[] memory)
    {
        require(_badgeContracts.length == _tokenIds.length, "BadgeManager.getDelegatedLists: arrays length mismatch");

        address[] memory delegatedAddresses = new address[](_badgeContracts.length);
        for (uint256 i = 0; i < _badgeContracts.length; i++) {
            delegatedAddresses[i] = delegatedList[_badgeContracts[i]][_tokenIds[i]];
        }
        return delegatedAddresses;
    }
}
